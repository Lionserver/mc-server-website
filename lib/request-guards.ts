import { normalizeIpAddress } from "@/lib/ip-security.mjs";

const SERVER_QUOTA_PER_OWNER = 5;
const SERVER_CREATIONS_PER_DAY = 10;
const PROFILE_LOOKUPS_PER_MINUTE = 30;
const UPLOADS_PER_HOUR = 30;
const SERVER_STORAGE_BYTES = 128 * 1024 * 1024;
const OWNER_STORAGE_BYTES = 512 * 1024 * 1024;

const rateLimitSchemaPromises = new WeakMap<object, Promise<void>>();
let lastRateLimitCleanupAt = 0;

export async function ensureRequestGuardSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  const key = db as unknown as object;
  let schemaPromise = rateLimitSchemaPromises.get(key);
  if (!schemaPromise) {
    schemaPromise = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS security_rate_limits (
        bucket TEXT NOT NULL,
        identity_hash TEXT NOT NULL,
        window_started INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bucket, identity_hash)
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS security_rate_limits_updated_idx ON security_rate_limits (updated_at)"),
    ]).then(() => undefined);
    rateLimitSchemaPromises.set(key, schemaPromise);
  }
  try {
    await schemaPromise;
  } catch (error) {
    rateLimitSchemaPromises.delete(key);
    throw error;
  }
}

export async function assertPublicProfileRateLimit(db: D1Database, request: Request) {
  await assertRateLimit(db, {
    bucket: "minecraft-profile-ip",
    identity: requestNetworkIdentity(request),
    limit: PROFILE_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
    message: "프로필 조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  });
}

export async function assertEmailCodeRequestAllowed(db: D1Database, request: Request, email: string) {
  await assertRateLimit(db, {
    bucket: "email-code-address",
    identity: email,
    limit: 3,
    windowSeconds: 600,
    message: "인증 코드 요청이 너무 많습니다. 10분 후 다시 시도해 주세요.",
  });
  await assertRateLimit(db, {
    bucket: "email-code-network",
    identity: requestNetworkIdentity(request),
    limit: 10,
    windowSeconds: 600,
    message: "이 네트워크에서 인증 코드 요청이 너무 많습니다. 10분 후 다시 시도해 주세요.",
  });
}

export async function assertServerCreationAllowed(db: D1Database, request: Request, ownerEmail: string) {
  const active = await db.prepare(`SELECT COUNT(*) count FROM directory_servers
    WHERE owner_email = ? AND deleted_at IS NULL`).bind(ownerEmail).first<{ count: number }>();
  if (Number(active?.count ?? 0) >= SERVER_QUOTA_PER_OWNER) {
    throw Response.json({ error: `운영자 계정당 서버는 최대 ${SERVER_QUOTA_PER_OWNER}개까지 등록할 수 있습니다.` }, { status: 409 });
  }
  if (!isLocalPreviewRequest(request)) {
    await assertRateLimit(db, {
      bucket: "server-create-burst",
      identity: ownerEmail,
      limit: 1,
      windowSeconds: 10,
      message: "서버 등록 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
    await assertRateLimit(db, {
      bucket: "server-create-owner",
      identity: ownerEmail,
      limit: SERVER_CREATIONS_PER_DAY,
      windowSeconds: 86_400,
      message: "서버 등록 요청이 너무 많습니다. 24시간 후 다시 시도해 주세요.",
    });
  }
}

export async function assertUploadAllowed(db: D1Database, request: Request, ownerEmail: string) {
  if (isLocalPreviewRequest(request)) return;
  await assertRateLimit(db, {
    bucket: "media-upload-burst",
    identity: ownerEmail,
    limit: 1,
    windowSeconds: 3,
    message: "이미지 저장 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.",
  });
  await Promise.all([
    assertRateLimit(db, {
      bucket: "media-upload-owner",
      identity: ownerEmail,
      limit: UPLOADS_PER_HOUR,
      windowSeconds: 3_600,
      message: "이미지 등록 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    }),
    assertRateLimit(db, {
      bucket: "media-upload-ip",
      identity: requestNetworkIdentity(request),
      limit: UPLOADS_PER_HOUR * 2,
      windowSeconds: 3_600,
      message: "이 네트워크에서 이미지 등록 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    }),
  ]);
}

export async function assertStorageQuota(
  db: D1Database,
  ownerEmail: string,
  serverId: string,
  incomingBytes: number,
  replacedBytes = 0,
) {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0 || !Number.isSafeInteger(replacedBytes) || replacedBytes < 0) {
    throw Response.json({ error: "업로드 용량을 확인할 수 없습니다." }, { status: 400 });
  }
  const [serverUsage, ownerUsage] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(size), 0) bytes FROM (
      SELECT size FROM server_assets WHERE server_id = ?
      UNION ALL SELECT size FROM server_description_assets WHERE server_id = ?
    )`).bind(serverId, serverId).first<{ bytes: number }>(),
    db.prepare(`SELECT COALESCE(SUM(asset_size), 0) bytes FROM (
      SELECT a.size asset_size FROM server_assets a
      JOIN directory_servers d ON d.id = a.server_id
      WHERE d.owner_email = ? AND d.deleted_at IS NULL
      UNION ALL
      SELECT a.size asset_size FROM server_description_assets a
      JOIN directory_servers d ON d.id = a.server_id
      WHERE d.owner_email = ? AND d.deleted_at IS NULL
    )`).bind(ownerEmail, ownerEmail).first<{ bytes: number }>(),
  ]);
  const serverNext = Number(serverUsage?.bytes ?? 0) - replacedBytes + incomingBytes;
  const ownerNext = Number(ownerUsage?.bytes ?? 0) - replacedBytes + incomingBytes;
  if (serverNext > SERVER_STORAGE_BYTES) {
    throw Response.json({ error: "서버별 이미지 저장 용량 128MB를 초과합니다. 기존 이미지를 정리해 주세요." }, { status: 413 });
  }
  if (ownerNext > OWNER_STORAGE_BYTES) {
    throw Response.json({ error: "운영자 계정의 전체 이미지 저장 용량 512MB를 초과합니다. 기존 이미지를 정리해 주세요." }, { status: 413 });
  }
}

export function assertRequestContentLength(request: Request, maximumBytes: number) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
    throw Response.json({ error: "업로드 요청 전체 용량이 허용 범위를 초과합니다." }, { status: 413 });
  }
}

async function assertRateLimit(db: D1Database, input: {
  bucket: string;
  identity: string;
  limit: number;
  windowSeconds: number;
  message: string;
}) {
  await ensureRequestGuardSchema(db);
  const now = Math.floor(Date.now() / 1000);
  const windowBoundary = now - input.windowSeconds;
  const identityHash = await sha256Hex(`${input.bucket}|${input.identity}`);
  const row = await db.prepare(`INSERT INTO security_rate_limits
    (bucket, identity_hash, window_started, request_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(bucket, identity_hash) DO UPDATE SET
      window_started = CASE WHEN security_rate_limits.window_started <= ? THEN excluded.window_started ELSE security_rate_limits.window_started END,
      request_count = CASE WHEN security_rate_limits.window_started <= ? THEN 1 ELSE security_rate_limits.request_count + 1 END,
      updated_at = excluded.updated_at
    RETURNING request_count, window_started`)
    .bind(input.bucket, identityHash, now, now, windowBoundary, windowBoundary)
    .first<{ request_count: number; window_started: number }>();
  if (!row) throw Response.json({ error: "요청 제한 상태를 확인할 수 없습니다." }, { status: 503 });
  if (now - lastRateLimitCleanupAt >= 3_600) {
    lastRateLimitCleanupAt = now;
    await db.prepare("DELETE FROM security_rate_limits WHERE updated_at < ?").bind(now - 7 * 86_400).run().catch(() => undefined);
  }
  if (row.request_count > input.limit) {
    const retryAfter = Math.max(1, row.window_started + input.windowSeconds - now);
    throw Response.json({ error: input.message }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
}

function requestNetworkIdentity(request: Request) {
  const rawAddress = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]
    ?? "";
  return normalizeIpAddress(rawAddress) ?? "unavailable";
}

function isLocalPreviewRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
    && request.headers.get("X-MKR-Local-Owner") === "minecraft-kr-local-preview";
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
