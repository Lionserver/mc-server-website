import { directoryEnv, ensureDirectorySchema, type DirectoryEnv } from "@/lib/server-directory";
import { resolveMinecraftEndpoint } from "@/lib/minecraft-ping";
import { ensureSiteAnnouncementSchema } from "@/lib/site-announcements";
import { ensureBridgeSchema } from "@/lib/bridge-api";
import { normalizeIpAddress } from "@/lib/ip-security.mjs";

export interface AdminEnvironment extends DirectoryEnv {
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_TOTP_SECRET?: string;
  ADMIN_LOCAL_PREVIEW?: string;
  ADMIN_LOCAL_PASSWORD?: string;
}

export type AdminSession = {
  email: string;
  expiresAt: number;
  authMode: "session";
};
export type BlacklistKind = "ip" | "address";
export type ServerEnforcementKind = "warning" | "suspension" | "blind";

const ADMIN_COOKIE = "mkr_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_SECONDS = 15 * 60;

export async function adminEnv(): Promise<AdminEnvironment> {
  return await directoryEnv() as AdminEnvironment;
}

export async function ensureAdminSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await ensureDirectorySchema(db);
  await ensureBridgeSchema(db);
  await ensureSiteAnnouncementSchema(db);
  const columns = await db.prepare("PRAGMA table_info(directory_servers)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["votes_override", "ALTER TABLE directory_servers ADD COLUMN votes_override INTEGER"],
    ["description_document", "ALTER TABLE directory_servers ADD COLUMN description_document TEXT NOT NULL DEFAULT ''"],
    ["votes_adjustment", "ALTER TABLE directory_servers ADD COLUMN votes_adjustment INTEGER NOT NULL DEFAULT 0"],
    ["uptime_basis_points", "ALTER TABLE directory_servers ADD COLUMN uptime_basis_points INTEGER"],
    ["uptime_adjustment_basis_points", "ALTER TABLE directory_servers ADD COLUMN uptime_adjustment_basis_points INTEGER NOT NULL DEFAULT 0"],
    ["premium_managed", "ALTER TABLE directory_servers ADD COLUMN premium_managed INTEGER NOT NULL DEFAULT 0"],
    ["premium_tier", "ALTER TABLE directory_servers ADD COLUMN premium_tier TEXT NOT NULL DEFAULT 'none'"],
    ["premium_starts_at", "ALTER TABLE directory_servers ADD COLUMN premium_starts_at INTEGER"],
    ["premium_ends_at", "ALTER TABLE directory_servers ADD COLUMN premium_ends_at INTEGER"],
    ["premium_note", "ALTER TABLE directory_servers ADD COLUMN premium_note TEXT NOT NULL DEFAULT ''"],
    ["owner_verification_status", "ALTER TABLE directory_servers ADD COLUMN owner_verification_status TEXT NOT NULL DEFAULT 'unverified'"],
    ["owner_verified_at", "ALTER TABLE directory_servers ADD COLUMN owner_verified_at INTEGER"],
    ["discord_url", "ALTER TABLE directory_servers ADD COLUMN discord_url TEXT NOT NULL DEFAULT ''"],
    ["discord_enabled", "ALTER TABLE directory_servers ADD COLUMN discord_enabled INTEGER NOT NULL DEFAULT 0"],
    ["website_url", "ALTER TABLE directory_servers ADD COLUMN website_url TEXT NOT NULL DEFAULT ''"],
    ["website_enabled", "ALTER TABLE directory_servers ADD COLUMN website_enabled INTEGER NOT NULL DEFAULT 0"],
    ["kakao_url", "ALTER TABLE directory_servers ADD COLUMN kakao_url TEXT NOT NULL DEFAULT ''"],
    ["kakao_enabled", "ALTER TABLE directory_servers ADD COLUMN kakao_enabled INTEGER NOT NULL DEFAULT 0"],
    ["staff_intro_enabled", "ALTER TABLE directory_servers ADD COLUMN staff_intro_enabled INTEGER NOT NULL DEFAULT 0"],
    ["resolved_ips", "ALTER TABLE directory_servers ADD COLUMN resolved_ips TEXT NOT NULL DEFAULT '[]'"],
    ["status_before_blacklist", "ALTER TABLE directory_servers ADD COLUMN status_before_blacklist TEXT"],
    ["status_before_enforcement", "ALTER TABLE directory_servers ADD COLUMN status_before_enforcement TEXT"],
  ];
  for (const [name, statement] of additions) {
    if (!existing.has(name)) await db.prepare(statement).run();
  }
  if (!existing.has("discord_enabled")) await db.prepare("UPDATE directory_servers SET discord_enabled = 1 WHERE discord_url <> ''").run();
  if (!existing.has("website_enabled")) await db.prepare("UPDATE directory_servers SET website_enabled = 1 WHERE website_url <> ''").run();

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      admin_email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_login_attempts (
      fingerprint TEXT PRIMARY KEY NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_logs (created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_blacklist (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at INTEGER,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS server_blacklist_lookup_idx ON server_blacklist (kind, value, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS server_blacklist_status_idx ON server_blacklist (status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS vote_source_blocks (
      id TEXT PRIMARY KEY NOT NULL,
      source_ip_hash TEXT NOT NULL,
      source_ip_masked TEXT NOT NULL,
      source_ip_version INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      resolved_by TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS vote_source_blocks_lookup_idx ON vote_source_blocks (source_ip_hash, status, expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS vote_source_blocks_status_idx ON vote_source_blocks (status, expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_enforcements (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at INTEGER NOT NULL,
      expires_at INTEGER,
      created_by TEXT NOT NULL,
      resolved_by TEXT,
      resolved_at INTEGER,
      resolution_note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS server_enforcements_server_idx ON server_enforcements (server_id, status, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS server_enforcements_active_idx ON server_enforcements (status, kind, expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_conversations (
      server_id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      unread_admin INTEGER NOT NULL DEFAULT 0,
      unread_owner INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_conversations_updated_idx ON admin_conversations (updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_messages (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS admin_messages_thread_idx ON admin_messages (server_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS operator_channel_messages (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      server_title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS operator_channel_created_idx ON operator_channel_messages (created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS operator_channel_server_idx ON operator_channel_messages (server_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS chat_realtime_tickets (
      token_hash TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      server_id TEXT,
      role TEXT NOT NULL,
      principal_email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS chat_realtime_tickets_expiry_idx ON chat_realtime_tickets (expires_at)"),
  ]);
  const now = unixNow();
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM admin_login_attempts WHERE updated_at < ?").bind(now - 86_400),
    db.prepare("DELETE FROM chat_realtime_tickets WHERE expires_at <= ?").bind(now),
  ]);
}

export async function loginAdmin(request: Request, payload: unknown) {
  assertSameOrigin(request);
  if (!payload || typeof payload !== "object") throw Response.json({ error: "로그인 정보를 확인해 주세요." }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const otp = typeof body.otp === "string" ? body.otp.replace(/\s/g, "") : "";
  if (!email || !password || !/^\d{6}$/.test(otp)) throw Response.json({ error: "이메일, 비밀번호와 OTP 6자리를 입력해 주세요." }, { status: 400 });

  const environment = await adminEnv();
  await ensureAdminSchema(environment.DB);
  const fingerprint = await loginFingerprint(request, email);
  const attempt = await environment.DB.prepare("SELECT failure_count, blocked_until FROM admin_login_attempts WHERE fingerprint = ?")
    .bind(fingerprint).first<{ failure_count: number; blocked_until: number }>();
  const now = unixNow();
  if (attempt && attempt.blocked_until > now) {
    throw Response.json({ error: "로그인 시도가 잠겼습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }

  const localPreview = isLocalPreview(request, environment);
  const configuredEmail = (localPreview ? "admin@minecraft.kr" : environment.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const validEmail = configuredEmail.length > 0 && await constantTimeEqualText(email, configuredEmail);
  const validPassword = localPreview
    ? await constantTimeEqualText(password, environment.ADMIN_LOCAL_PASSWORD ?? "")
    : await verifyPasswordHash(password, environment.ADMIN_PASSWORD_HASH ?? "");
  const validOtp = localPreview ? otp === "000000" : await verifyTotp(otp, environment.ADMIN_TOTP_SECRET ?? "");

  if (!configuredEmail || (!localPreview && (!environment.ADMIN_PASSWORD_HASH || !environment.ADMIN_TOTP_SECRET))) {
    throw Response.json({ error: "총관리자 인증 환경값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (!validEmail || !validPassword || !validOtp) {
    const failure = await environment.DB.prepare(`INSERT INTO admin_login_attempts
      (fingerprint, failure_count, blocked_until, updated_at)
      VALUES (?, 1, 0, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        failure_count = admin_login_attempts.failure_count + 1,
        blocked_until = CASE
          WHEN admin_login_attempts.failure_count + 1 >= ?
            THEN MAX(admin_login_attempts.blocked_until, ?)
          ELSE admin_login_attempts.blocked_until
        END,
        updated_at = excluded.updated_at
      RETURNING failure_count, blocked_until`)
      .bind(fingerprint, now, MAX_LOGIN_FAILURES, now + LOGIN_BLOCK_SECONDS)
      .first<{ failure_count: number; blocked_until: number }>();
    if (!failure) throw Response.json({ error: "로그인 제한 상태를 확인하지 못했습니다." }, { status: 503 });
    const failureCount = failure.failure_count;
    await writeAudit(environment.DB, email || "unknown", "admin.login.failed", "session", fingerprint.slice(0, 12), { failureCount });
    throw Response.json({
      error: failure.blocked_until > now
        ? "로그인 시도가 잠겼습니다. 15분 후 다시 시도해 주세요."
        : "관리자 인증 정보가 일치하지 않습니다.",
    }, { status: failure.blocked_until > now ? 429 : 401 });
  }

  await environment.DB.prepare("DELETE FROM admin_login_attempts WHERE fingerprint = ?").bind(fingerprint).run();
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + SESSION_SECONDS;
  await environment.DB.prepare("INSERT INTO admin_sessions (token_hash, admin_email, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
    .bind(tokenHash, configuredEmail, now, expiresAt, now).run();
  await writeAudit(environment.DB, configuredEmail, "admin.login.succeeded", "session", tokenHash.slice(0, 12), { expiresAt });
  return { email: configuredEmail, expiresAt, cookie: sessionCookie(request, token, SESSION_SECONDS) };
}

export async function requireAdmin(request: Request, options?: { mutating?: boolean }): Promise<{ environment: AdminEnvironment; session: AdminSession; tokenHash: string }> {
  if (options?.mutating) assertSameOrigin(request);
  const environment = await adminEnv();
  await ensureAdminSchema(environment.DB);
  const now = unixNow();
  const token = cookieValue(request.headers.get("cookie") ?? "", ADMIN_COOKIE);
  if (token && token.length >= 32) {
    const tokenHash = await sha256Hex(token);
    const row = await environment.DB.prepare("SELECT admin_email, expires_at, last_seen_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
      .bind(tokenHash, now).first<{ admin_email: string; expires_at: number; last_seen_at: number }>();
    if (row) {
      if (now - row.last_seen_at > 300) {
        await environment.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
      }
      return {
        environment,
        session: { email: row.admin_email, expiresAt: row.expires_at, authMode: "session" },
        tokenHash,
      };
    }
  }
  if (token) throw Response.json({ error: "관리자 세션이 만료되었습니다." }, { status: 401 });
  throw Response.json({ error: "총관리자 로그인이 필요합니다." }, { status: 401 });
}

export async function logoutAdmin(request: Request) {
  const { environment, session, tokenHash } = await requireAdmin(request, { mutating: true });
  await environment.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
  await writeAudit(environment.DB, session.email, "admin.logout", "session", tokenHash.slice(0, 12), {});
  return expiredSessionCookie(request);
}

export async function writeAudit(db: D1Database, adminEmail: string, action: string, targetType: string, targetId: string, details: Record<string, unknown>) {
  await prepareAuditWrite(db, adminEmail, action, targetType, targetId, details).run();
}

export function prepareAuditWrite(
  db: D1Database,
  adminEmail: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
  options?: { createdAt?: number; onlyIfPreviousStatementChanged?: boolean },
) {
  const sql = options?.onlyIfPreviousStatementChanged
    ? `INSERT INTO admin_audit_logs (id, admin_email, action, target_type, target_id, details, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`
    : `INSERT INTO admin_audit_logs (id, admin_email, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;
  return db.prepare(sql).bind(
    crypto.randomUUID().replaceAll("-", ""),
    adminEmail.slice(0, 254),
    action.slice(0, 80),
    targetType.slice(0, 40),
    targetId.slice(0, 160),
    JSON.stringify(details).slice(0, 5000),
    options?.createdAt ?? unixNow(),
  );
}

export function normalizeBlacklistValue(kind: BlacklistKind, rawValue: unknown) {
  if (typeof rawValue !== "string") throw Response.json({ error: "차단 값을 입력해 주세요." }, { status: 400 });
  const value = rawValue.trim().toLowerCase();
  if (kind === "address") {
    if (!/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value)) throw Response.json({ error: "유효한 서버 주소를 입력해 주세요." }, { status: 400 });
  } else if (!isIpAddress(value)) {
    throw Response.json({ error: "유효한 IPv4 또는 IPv6 주소를 입력해 주세요." }, { status: 400 });
  }
  return value;
}

export async function assertNotBlacklisted(db: D1Database, values: { address?: string; ip?: string }) {
  await synchronizeBlacklist(db);
  const now = unixNow();
  for (const [kind, rawValue] of [["address", values.address], ["ip", values.ip]] as const) {
    if (!rawValue) continue;
    const value = rawValue.trim().toLowerCase();
    const match = await db.prepare(`SELECT id, reason FROM server_blacklist
      WHERE kind = ? AND value = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`)
      .bind(kind, value, now).first<{ id: string; reason: string }>();
    if (match) throw Response.json({ error: "차단된 서버 주소 또는 IP입니다.", blacklistId: match.id }, { status: 403 });
  }
}

export async function assertAddressNotBlacklisted(db: D1Database, address: string, port = 25565) {
  const endpoint = await resolveMinecraftEndpoint(address, port);
  const [directIps, endpointIps] = await Promise.all([
    resolveHostIps(address),
    endpoint.host === address ? Promise.resolve([]) : resolveHostIps(endpoint.host),
  ]);
  const ips = [...new Set([...directIps, ...endpointIps])];
  await assertNotBlacklisted(db, { address });
  if (endpoint.host !== address) await assertNotBlacklisted(db, { address: endpoint.host });
  for (const ip of ips) await assertNotBlacklisted(db, { ip });
  return ips;
}

export async function resolveHostIps(address: string) {
  const results = new Set<string>();
  await Promise.all(["A", "AAAA"].map(async (type) => {
    try {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(address)}&type=${type}`, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return;
      const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
      for (const answer of body.Answer ?? []) {
        const value = normalizeIpAddress(answer.data?.trim().toLowerCase() ?? "");
        if (value) results.add(value);
      }
    } catch {
      // A DNS outage must not make server editing unavailable. Ownership verification still
      // requires the actual server to answer before it can become public.
    }
  }));
  return [...results];
}

export async function synchronizeBlacklist(db: D1Database) {
  const now = unixNow();
  await db.prepare(`UPDATE server_blacklist SET status = 'expired', updated_at = ?
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`).bind(now, now).run();
  await db.prepare(`UPDATE directory_servers AS d SET
    status = COALESCE(d.status_before_blacklist,
      CASE WHEN d.bridge_server_id IN (SELECT server_id FROM bridge_servers WHERE verified_at IS NOT NULL) THEN 'active' ELSE 'draft' END),
    status_before_blacklist = NULL,
    updated_at = ?
    WHERE d.status = 'blacklisted' AND d.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM server_blacklist bl WHERE bl.status = 'active'
          AND (bl.expires_at IS NULL OR bl.expires_at > ?)
          AND ((bl.kind = 'address' AND bl.value = lower(d.address))
            OR (bl.kind = 'ip' AND instr(lower(d.resolved_ips), '"' || lower(bl.value) || '"') > 0))
      )`).bind(now, now).run();
}

export async function synchronizeServerEnforcements(db: D1Database) {
  const now = unixNow();
  await db.prepare(`UPDATE server_enforcements SET status = 'expired', resolved_at = ?, updated_at = ?
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`).bind(now, now, now).run();

  await db.prepare(`UPDATE directory_servers AS d SET
    status = COALESCE(d.status_before_enforcement,
      CASE WHEN d.bridge_server_id IN (SELECT server_id FROM bridge_servers WHERE verified_at IS NOT NULL) THEN 'active' ELSE 'draft' END),
    status_before_enforcement = NULL,
    updated_at = ?
    WHERE d.status IN ('suspended', 'blinded') AND d.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM server_enforcements e WHERE e.server_id = d.id AND e.status = 'active'
          AND e.kind IN ('suspension', 'blind') AND (e.expires_at IS NULL OR e.expires_at > ?)
      )`).bind(now, now).run();

  await db.prepare(`UPDATE directory_servers AS d SET
    status_before_enforcement = CASE WHEN d.status IN ('suspended', 'blinded') THEN d.status_before_enforcement ELSE d.status END,
    status = 'blinded', updated_at = ?
    WHERE d.deleted_at IS NULL AND d.status <> 'blacklisted'
      AND EXISTS (
        SELECT 1 FROM server_enforcements e WHERE e.server_id = d.id AND e.status = 'active'
          AND e.kind = 'blind' AND (e.expires_at IS NULL OR e.expires_at > ?)
      )`).bind(now, now).run();

  await db.prepare(`UPDATE directory_servers AS d SET
    status_before_enforcement = CASE WHEN d.status IN ('suspended', 'blinded') THEN d.status_before_enforcement ELSE d.status END,
    status = 'suspended', updated_at = ?
    WHERE d.deleted_at IS NULL AND d.status <> 'blacklisted'
      AND EXISTS (
        SELECT 1 FROM server_enforcements e WHERE e.server_id = d.id AND e.status = 'active'
          AND e.kind = 'suspension' AND (e.expires_at IS NULL OR e.expires_at > ?)
      )`).bind(now, now).run();
}

export function cleanMessage(value: unknown) {
  if (typeof value !== "string") throw Response.json({ error: "메시지를 입력해 주세요." }, { status: 400 });
  const body = value.trim();
  if (body.length < 1 || body.length > 2000) throw Response.json({ error: "메시지는 1-2,000자로 입력해 주세요." }, { status: 400 });
  return body;
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "unexpected error";
  console.error("admin request failed", error);
  return Response.json({ error: process.env.NODE_ENV === "production" ? "요청을 처리하지 못했습니다." : message }, { status: 500 });
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (!origin || origin !== url.origin) throw Response.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
}

function isLocalPreview(request: Request, environment: AdminEnvironment) {
  const hostname = new URL(request.url).hostname;
  return environment.ADMIN_LOCAL_PREVIEW === "true" && (hostname === "localhost" || hostname === "127.0.0.1");
}

async function verifyPasswordHash(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
  try {
    const salt = base64UrlBytes(parts[2]);
    const expected = base64UrlBytes(parts[3]);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expected.length * 8));
    return constantTimeEqualBytes(derived, expected);
  } catch {
    return false;
  }
}

async function verifyTotp(code: string, secret: string) {
  let secretBytes: Uint8Array;
  try { secretBytes = decodeBase32(secret); } catch { return false; }
  if (secretBytes.length < 10) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    const value = counter + offset;
    view.setUint32(0, Math.floor(value / 2 ** 32));
    view.setUint32(4, value >>> 0);
    const key = await crypto.subtle.importKey("raw", secretBytes.slice().buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
    const index = signature[signature.length - 1] & 0x0f;
    const binary = ((signature[index] & 0x7f) << 24) | (signature[index + 1] << 16) | (signature[index + 2] << 8) | signature[index + 3];
    const expected = String(binary % 1_000_000).padStart(6, "0");
    if (await constantTimeEqualText(code, expected)) return true;
  }
  return false;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  return bytes;
}

function isIpAddress(value: string) {
  return normalizeIpAddress(value) !== null;
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function expiredSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function cookieValue(header: string, name: string) {
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function loginFingerprint(request: Request, email: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  return sha256Hex(`${ip.trim()}|${email.slice(0, 254)}`);
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqualText(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  return constantTimeEqualBytes(new TextEncoder().encode(leftHash), new TextEncoder().encode(rightHash));
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
