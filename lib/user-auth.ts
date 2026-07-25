import { directoryEnv, type DirectoryEnv } from "@/lib/server-directory";
import { assertEmailCodeRequestAllowed } from "@/lib/request-guards";

export interface UserAuthEnvironment extends DirectoryEnv {
  AUTH_CODE_SECRET?: string;
  AUTH_LOCAL_PREVIEW?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  ADMIN_EMAIL?: string;
  SITES_AUTH_ENABLED?: string;
}

export type OwnerSession = { accountId: string; email: string; expiresAt: number; authMode: "email" | "sites" };

export const OWNER_COOKIE = "mkr_owner_session";
const CODE_SECONDS = 10 * 60;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_CODE_ATTEMPTS = 5;

export async function userAuthEnv() {
  return await directoryEnv() as UserAuthEnvironment;
}

export async function ensureUserAuthSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS user_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified_at INTEGER NOT NULL,
      last_login_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_email_idx ON user_accounts (email)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_login_codes (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS user_login_codes_email_idx ON user_login_codes (email, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS user_login_codes_expiry_idx ON user_login_codes (expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS user_sessions_account_idx ON user_sessions (account_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx ON user_sessions (expires_at)"),
  ]);
  const accountColumns = await db.prepare("PRAGMA table_info(user_accounts)").all<{ name: string }>();
  const accountNames = new Set(accountColumns.results.map((column) => column.name));
  const accountAdditions: Array<[string, string]> = [
    ["identity_verification_status", "ALTER TABLE user_accounts ADD COLUMN identity_verification_status TEXT NOT NULL DEFAULT 'unverified'"],
    ["identity_verified_at", "ALTER TABLE user_accounts ADD COLUMN identity_verified_at INTEGER"],
    ["identity_provider", "ALTER TABLE user_accounts ADD COLUMN identity_provider TEXT NOT NULL DEFAULT ''"],
    ["identity_reference", "ALTER TABLE user_accounts ADD COLUMN identity_reference TEXT NOT NULL DEFAULT ''"],
    ["account_status", "ALTER TABLE user_accounts ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'"],
    ["suspended_at", "ALTER TABLE user_accounts ADD COLUMN suspended_at INTEGER"],
    ["suspended_by", "ALTER TABLE user_accounts ADD COLUMN suspended_by TEXT"],
    ["suspension_reason", "ALTER TABLE user_accounts ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, statement] of accountAdditions) if (!accountNames.has(name)) await db.prepare(statement).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS user_accounts_status_idx ON user_accounts (account_status, updated_at)").run();
  const codeColumns = await db.prepare("PRAGMA table_info(user_login_codes)").all<{ name: string }>();
  if (!codeColumns.results.some((column) => column.name === "request_ip_hash")) {
    await db.prepare("ALTER TABLE user_login_codes ADD COLUMN request_ip_hash TEXT NOT NULL DEFAULT ''").run();
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS user_login_codes_ip_idx ON user_login_codes (request_ip_hash, created_at)").run();
  const now = unixNow();
  await db.batch([
    db.prepare("DELETE FROM user_login_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL AND consumed_at < ?").bind(now, now - 86_400),
    db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now),
  ]);
}

export async function requestEmailCode(request: Request, payload: unknown) {
  assertSameOrigin(request);
  const email = normalizeEmail((payload as { email?: unknown } | null)?.email);
  const environment = await userAuthEnv();
  await ensureUserAuthSchema(environment.DB);
  const now = unixNow();
  if (await isSuspendedAccount(environment.DB, email)) {
    throw Response.json({ error: "정지된 운영자 계정입니다. 관리자에게 문의해 주세요.", code: "account_suspended" }, { status: 423 });
  }
  const fingerprint = await requestFingerprint(environment, request, email);
  const ipHash = await requestIpHash(environment, request);
  await assertEmailCodeRequestAllowed(environment.DB, request, email);

  const id = crypto.randomUUID().replaceAll("-", "");
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const codeHash = await authCodeHash(environment, id, email, code);
  await environment.DB.prepare(`INSERT INTO user_login_codes
    (id, email, code_hash, request_fingerprint, request_ip_hash, attempts, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).bind(id, email, codeHash, fingerprint, ipHash, now + CODE_SECONDS, now).run();

  const localPreview = isLocal(request) && environment.AUTH_LOCAL_PREVIEW === "true";
  if (!localPreview) {
    try {
      await sendProductEmail(environment, {
        to: email,
        subject: "Minecraft.kr 로그인 인증 코드",
        text: `Minecraft.kr 로그인 인증 코드는 ${code}입니다. 10분 동안 유효하며 다른 사람에게 공유하지 마세요.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px"><b style="font-size:18px">Minecraft.kr</b><h1 style="font-size:22px">로그인 인증 코드</h1><p style="font-size:36px;font-weight:800;letter-spacing:8px">${code}</p><p>10분 동안 유효하며 다른 사람에게 공유하지 마세요.</p></div>`,
        idempotencyKey: `login-code/${id}`,
      });
    } catch (error) {
      await environment.DB.prepare("DELETE FROM user_login_codes WHERE id = ?").bind(id).run();
      throw error;
    }
  }
  return { sent: true, expiresAt: now + CODE_SECONDS, ...(localPreview ? { previewCode: code } : {}) };
}

export async function verifyEmailCode(request: Request, payload: unknown) {
  assertSameOrigin(request);
  if (!payload || typeof payload !== "object") throw Response.json({ error: "인증 정보를 확인해 주세요." }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (!/^\d{6}$/.test(code)) throw Response.json({ error: "인증 코드 6자리를 입력해 주세요." }, { status: 400 });
  const environment = await userAuthEnv();
  await ensureUserAuthSchema(environment.DB);
  const now = unixNow();
  const row = await environment.DB.prepare(`SELECT id, code_hash, attempts, expires_at FROM user_login_codes
    WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(email)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at <= now || row.attempts >= MAX_CODE_ATTEMPTS) {
    throw Response.json({ error: "인증 코드가 만료되었습니다. 새 코드를 요청해 주세요." }, { status: 401 });
  }
  const suppliedHash = await authCodeHash(environment, row.id, email, code);
  if (!constantTimeEqual(suppliedHash, row.code_hash)) {
    await environment.DB.prepare("UPDATE user_login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    throw Response.json({ error: "인증 코드가 올바르지 않습니다." }, { status: 401 });
  }

  const existing = await environment.DB.prepare("SELECT id, account_status FROM user_accounts WHERE email = ?")
    .bind(email).first<{ id: string; account_status: string }>();
  if (existing?.account_status === "suspended") {
    await environment.DB.prepare("UPDATE user_login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(now, row.id).run();
    throw Response.json({ error: "정지된 운영자 계정입니다. 관리자에게 문의해 주세요.", code: "account_suspended" }, { status: 423 });
  }
  const accountId = existing?.id ?? crypto.randomUUID().replaceAll("-", "");
  const sessionToken = randomToken(32);
  const tokenHash = await sha256Hex(sessionToken);
  const consumed = await environment.DB.prepare(`UPDATE user_login_codes SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL AND attempts < ? AND expires_at > ?`)
    .bind(now, row.id, MAX_CODE_ATTEMPTS, now).run();
  if (consumed.meta.changes !== 1) throw Response.json({ error: "인증 코드가 이미 사용되었습니다. 새 코드를 요청해 주세요." }, { status: 409 });
  const results = await environment.DB.batch([
    environment.DB.prepare(`INSERT INTO user_accounts
      (id, email, email_verified_at, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET email_verified_at = excluded.email_verified_at,
      last_login_at = excluded.last_login_at, updated_at = excluded.updated_at
      WHERE user_accounts.account_status = 'active'`)
      .bind(accountId, email, now, now, now, now),
    environment.DB.prepare("UPDATE user_login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL").bind(now, email),
    environment.DB.prepare(`INSERT INTO user_sessions
      (token_hash, account_id, email, expires_at, created_at, last_seen_at)
      SELECT ?, id, email, ?, ?, ? FROM user_accounts
      WHERE id = ? AND email = ? AND account_status = 'active'`)
      .bind(tokenHash, now + SESSION_SECONDS, now, now, accountId, email),
  ]);
  if ((results[2]?.meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "정지된 운영자 계정입니다. 관리자에게 문의해 주세요.", code: "account_suspended" }, { status: 423 });
  }
  return {
    session: { accountId, email, expiresAt: now + SESSION_SECONDS, authMode: "email" as const },
    cookie: ownerCookie(request, sessionToken, SESSION_SECONDS),
  };
}

export async function getOwnerSession(request: Request): Promise<OwnerSession | null> {
  const environment = await userAuthEnv();
  return getOwnerSessionFromDb(environment.DB, request);
}

export function hasOwnerSessionCookie(request: Request) {
  return Boolean(cookieValue(request.headers.get("cookie") ?? "", OWNER_COOKIE));
}

export async function getOwnerSessionFromDb(db: D1Database, request: Request): Promise<OwnerSession | null> {
  const token = cookieValue(request.headers.get("cookie") ?? "", OWNER_COOKIE);
  const now = unixNow();
  if (token && token.length >= 32 && token.length <= 160) {
    await ensureUserAuthSchema(db);
    const tokenHash = await sha256Hex(token);
    const row = await db.prepare(`SELECT s.account_id, s.email, s.expires_at, s.last_seen_at
      FROM user_sessions s JOIN user_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND a.account_status = 'active'`).bind(tokenHash, now)
      .first<{ account_id: string; email: string; expires_at: number; last_seen_at: number }>();
    if (row) {
      if (row.last_seen_at < now - 60) {
        await db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
      }
      return { accountId: row.account_id, email: row.email, expiresAt: row.expires_at, authMode: "email" };
    }
  }
  const platformEmail = trustedPlatformUserEmail(request);
  if (!platformEmail) return null;
  await ensureUserAuthSchema(db);
  const existing = await db.prepare("SELECT id, account_status FROM user_accounts WHERE email = ?")
    .bind(platformEmail).first<{ id: string; account_status: string }>();
  if (existing?.account_status === "suspended") return null;
  let accountId = existing?.id;
  if (!accountId) {
    const proposedId = crypto.randomUUID().replaceAll("-", "");
    await db.prepare(`INSERT INTO user_accounts
      (id, email, email_verified_at, last_login_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`)
      .bind(proposedId, platformEmail, now, now, now, now).run();
    const created = await db.prepare("SELECT id, account_status FROM user_accounts WHERE email = ?")
      .bind(platformEmail).first<{ id: string; account_status: string }>();
    if (created?.account_status === "suspended") return null;
    accountId = created?.id;
  }
  if (!accountId) return null;
  return { accountId, email: platformEmail, expiresAt: now + 5 * 60, authMode: "sites" };
}

export async function resolveOwnerSessionEmail(db: D1Database, request: Request) {
  return (await getOwnerSessionFromDb(db, request))?.email ?? null;
}

export function trustedPlatformUserEmail(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export async function logoutOwner(request: Request) {
  assertSameOrigin(request);
  const environment = await userAuthEnv();
  await ensureUserAuthSchema(environment.DB);
  const token = cookieValue(request.headers.get("cookie") ?? "", OWNER_COOKIE);
  if (token) await environment.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return expiredOwnerCookie(request);
}

export async function sendProductEmail(environment: UserAuthEnvironment, message: {
  to: string; subject: string; text: string; html?: string; idempotencyKey: string;
}) {
  if (!environment.RESEND_API_KEY || !environment.AUTH_EMAIL_FROM) {
    throw Response.json({ error: "이메일 발송 서비스가 준비되지 않았습니다." }, { status: 503 });
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotencyKey,
    },
    body: JSON.stringify({ from: environment.AUTH_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
  });
  if (!response.ok) throw Response.json({ error: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  return true;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) throw Response.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
}

export function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Response.json({ error: "올바른 이메일 주소를 입력해 주세요." }, { status: 400 });
  }
  return email;
}

async function authCodeHash(environment: UserAuthEnvironment, id: string, email: string, code: string) {
  return authHmacHex(environment, `code|${id}:${email}:${code}`);
}

async function authHmacHex(environment: UserAuthEnvironment, value: string) {
  const secret = environment.AUTH_CODE_SECRET;
  if (!secret || secret.length < 24) throw Response.json({ error: "인증 보안 설정이 준비되지 않았습니다." }, { status: 503 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function requestFingerprint(environment: UserAuthEnvironment, request: Request, email: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  return authHmacHex(environment, `request|${ip.trim()}|${email}`);
}

async function requestIpHash(environment: UserAuthEnvironment, request: Request) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  return authHmacHex(environment, `ip|${ip.trim()}`);
}

function ownerCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${OWNER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function expiredOwnerCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function cookieValue(header: string, name: string) {
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function isLocal(request: Request) {
  return new Set(["localhost", "127.0.0.1"]).has(new URL(request.url).hostname);
}

function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function isSuspendedAccount(db: D1Database, email: string) {
  return Boolean(await db.prepare(`SELECT 1 suspended FROM user_accounts
    WHERE email = ? AND account_status = 'suspended' LIMIT 1`).bind(email).first());
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
