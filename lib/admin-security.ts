import { directoryEnv, ensureDirectorySchema, type DirectoryEnv } from "@/lib/server-directory";
import { resolveMinecraftEndpoint } from "@/lib/minecraft-ping";
import { ensureSiteAnnouncementSchema } from "@/lib/site-announcements";
import { ensureBridgeSchema } from "@/lib/bridge-api";
import { normalizeIpAddress } from "@/lib/ip-security.mjs";
import {
  isAdminPasswordHash,
  isTotpSecret,
  verifyAdminPassword,
  verifyTotpCode,
} from "@/lib/admin-credentials.mjs";
import { maskIpAddress, requestIpAddress } from "@/lib/vote-source";
import { disconnectChatPrincipal } from "@/lib/chat-realtime-control";

export interface AdminEnvironment extends DirectoryEnv {
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_TOTP_SECRET?: string;
  ADMIN_CREDENTIALS_ROTATED_AT?: string;
  ADMIN_LOCAL_PREVIEW?: string;
  ADMIN_LOCAL_PASSWORD?: string;
}

export type AdminSession = {
  email: string;
  expiresAt: number;
  sessionId: string;
  elevatedUntil: number;
  authMode: "session";
};
export type AdminSessionSummary = {
  sessionId: string;
  current: boolean;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  elevatedUntil: number;
  sourceIpMasked: string;
  userAgentLabel: string;
};
export type BlacklistKind = "ip" | "address";
export type ServerEnforcementKind = "warning" | "suspension" | "blind";

const ADMIN_COOKIE = "mkr_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const STEP_UP_SECONDS = 5 * 60;
const MAX_LOGIN_FAILURES = 5;
const MAX_LOGIN_FAILURES_PER_IP = 20;
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
    ["status_before_deletion", "ALTER TABLE directory_servers ADD COLUMN status_before_deletion TEXT"],
    ["deletion_reason", "ALTER TABLE directory_servers ADD COLUMN deletion_reason TEXT NOT NULL DEFAULT ''"],
    ["deleted_by", "ALTER TABLE directory_servers ADD COLUMN deleted_by TEXT"],
    ["purge_after", "ALTER TABLE directory_servers ADD COLUMN purge_after INTEGER"],
    ["purged_at", "ALTER TABLE directory_servers ADD COLUMN purged_at INTEGER"],
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
  const sessionColumns = await db.prepare("PRAGMA table_info(admin_sessions)").all<{ name: string }>();
  const sessionNames = new Set(sessionColumns.results.map((column) => column.name));
  const sessionAdditions: Array<[string, string]> = [
    ["session_id", "ALTER TABLE admin_sessions ADD COLUMN session_id TEXT"],
    ["elevated_until", "ALTER TABLE admin_sessions ADD COLUMN elevated_until INTEGER NOT NULL DEFAULT 0"],
    ["source_ip_masked", "ALTER TABLE admin_sessions ADD COLUMN source_ip_masked TEXT NOT NULL DEFAULT ''"],
    ["user_agent_label", "ALTER TABLE admin_sessions ADD COLUMN user_agent_label TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, statement] of sessionAdditions) {
    if (!sessionNames.has(name)) await db.prepare(statement).run();
  }
  await db.prepare(`UPDATE admin_sessions SET session_id = lower(hex(randomblob(16)))
    WHERE session_id IS NULL OR length(session_id) <> 32`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS admin_sessions_session_id_idx ON admin_sessions (session_id)").run();
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
  const { credential: fingerprint, source: sourceFingerprint } = await loginFingerprints(request, email);
  let [attempt, sourceAttempt] = await Promise.all([
    loginAttempt(environment.DB, fingerprint),
    loginAttempt(environment.DB, sourceFingerprint),
  ]);
  const now = unixNow();
  const credentialsRotatedAt = parseUnixTimestamp(environment.ADMIN_CREDENTIALS_ROTATED_AT);
  const staleFingerprints = [
    attempt && credentialsRotatedAt > 0 && attempt.updated_at < credentialsRotatedAt ? fingerprint : null,
    sourceAttempt && credentialsRotatedAt > 0 && sourceAttempt.updated_at < credentialsRotatedAt ? sourceFingerprint : null,
  ].filter((value): value is string => Boolean(value));
  if (staleFingerprints.length > 0) {
    await environment.DB.batch(staleFingerprints.map((value) => environment.DB.prepare("DELETE FROM admin_login_attempts WHERE fingerprint = ?").bind(value)));
    if (staleFingerprints.includes(fingerprint)) attempt = null;
    if (staleFingerprints.includes(sourceFingerprint)) sourceAttempt = null;
  }
  if ((attempt && attempt.blocked_until > now) || (sourceAttempt && sourceAttempt.blocked_until > now)) {
    throw Response.json({ error: "로그인 시도가 잠겼습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }

  const localPreview = isLocalPreview(request, environment);
  const configuredEmail = configuredAdminEmail(request, environment);
  const credentialsConfigured = localPreview || (
    isAdminPasswordHash(environment.ADMIN_PASSWORD_HASH)
    && isTotpSecret(environment.ADMIN_TOTP_SECRET)
  );
  if (!configuredEmail || !credentialsConfigured) {
    throw Response.json({ error: "총관리자 인증 환경값이 올바르게 설정되지 않았습니다." }, { status: 503 });
  }
  const validEmail = configuredEmail.length > 0 && await constantTimeEqualText(email, configuredEmail);
  const validPassword = localPreview
    ? await constantTimeEqualText(password, environment.ADMIN_LOCAL_PASSWORD ?? "")
    : await verifyAdminPassword(password, environment.ADMIN_PASSWORD_HASH ?? "");
  const validOtp = localPreview ? otp === "000000" : await verifyTotpCode(otp, environment.ADMIN_TOTP_SECRET ?? "");

  if (!validEmail || !validPassword || !validOtp) {
    console.warn("admin login rejected", {
      emailMatches: validEmail,
      passwordMatches: validPassword,
      otpMatches: validOtp,
      localPreview,
      credentialRotationConfigured: credentialsRotatedAt > 0,
    });
    const failures = await environment.DB.batch<{ failure_count: number; blocked_until: number }>([
      environment.DB.prepare(`INSERT INTO admin_login_attempts
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
      .bind(fingerprint, now, MAX_LOGIN_FAILURES, now + LOGIN_BLOCK_SECONDS),
      environment.DB.prepare(`INSERT INTO admin_login_attempts
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
      .bind(sourceFingerprint, now, MAX_LOGIN_FAILURES_PER_IP, now + LOGIN_BLOCK_SECONDS),
    ]);
    const failure = failures[0]?.results[0];
    const sourceFailure = failures[1]?.results[0];
    if (!failure || !sourceFailure) throw Response.json({ error: "로그인 제한 상태를 확인하지 못했습니다." }, { status: 503 });
    const failureCount = failure.failure_count;
    const blocked = failure.blocked_until > now || sourceFailure.blocked_until > now;
    await writeAudit(environment.DB, email || "unknown", "admin.login.failed", "session", fingerprint.slice(0, 12), {
      failureCount,
      sourceFailureCount: sourceFailure.failure_count,
    });
    throw Response.json({
      error: blocked
        ? "로그인 시도가 잠겼습니다. 15분 후 다시 시도해 주세요."
        : "관리자 인증 정보가 일치하지 않습니다.",
    }, { status: blocked ? 429 : 401 });
  }

  await environment.DB.batch([
    environment.DB.prepare("DELETE FROM admin_login_attempts WHERE fingerprint = ?").bind(fingerprint),
    environment.DB.prepare("DELETE FROM admin_login_attempts WHERE fingerprint = ?").bind(sourceFingerprint),
  ]);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = now + SESSION_SECONDS;
  const elevatedUntil = Math.min(expiresAt, now + STEP_UP_SECONDS);
  await environment.DB.batch([
    environment.DB.prepare(`INSERT INTO admin_sessions
      (token_hash, admin_email, created_at, expires_at, last_seen_at, session_id, elevated_until, source_ip_masked, user_agent_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(tokenHash, configuredEmail, now, expiresAt, now, sessionId, elevatedUntil,
        maskIpAddress(requestIpAddress(request)), adminUserAgentLabel(request)),
    prepareAuditWrite(environment.DB, configuredEmail, "admin.login.succeeded", "session", sessionId, {
      expiresAt,
      elevatedUntil,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  ]);
  return { email: configuredEmail, expiresAt, elevatedUntil, cookie: sessionCookie(request, token, SESSION_SECONDS) };
}

export async function requireAdmin(
  request: Request,
  options?: { mutating?: boolean; stepUp?: boolean },
): Promise<{ environment: AdminEnvironment; session: AdminSession; tokenHash: string }> {
  if (options?.mutating || options?.stepUp) assertSameOrigin(request);
  const environment = await adminEnv();
  await ensureAdminSchema(environment.DB);
  const now = unixNow();
  const token = cookieValue(request.headers.get("cookie") ?? "", ADMIN_COOKIE);
  if (token && token.length >= 32) {
    const tokenHash = await sha256Hex(token);
    const row = await environment.DB.prepare(`SELECT admin_email, created_at, expires_at, last_seen_at,
      session_id, elevated_until FROM admin_sessions WHERE token_hash = ? AND expires_at > ?`)
      .bind(tokenHash, now).first<{
        admin_email: string; created_at: number; expires_at: number; last_seen_at: number;
        session_id: string | null; elevated_until: number;
      }>();
    if (row) {
      const configuredEmail = configuredAdminEmail(request, environment);
      const credentialsRotatedAt = parseUnixTimestamp(environment.ADMIN_CREDENTIALS_ROTATED_AT);
      const emailMatches = configuredEmail.length > 0 && await constantTimeEqualText(row.admin_email, configuredEmail);
      if (!emailMatches || (credentialsRotatedAt > 0 && row.created_at < credentialsRotatedAt)) {
        await environment.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
        throw Response.json({ error: "관리자 자격증명이 변경되었습니다. 다시 로그인해 주세요." }, { status: 401 });
      }
      if (now - row.last_seen_at > 300) {
        await environment.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
      }
      let sessionId = row.session_id;
      if (!sessionId) {
        const proposedId = crypto.randomUUID().replaceAll("-", "");
        await environment.DB.prepare("UPDATE admin_sessions SET session_id = ? WHERE token_hash = ? AND session_id IS NULL")
          .bind(proposedId, tokenHash).run();
        sessionId = (await environment.DB.prepare("SELECT session_id FROM admin_sessions WHERE token_hash = ?")
          .bind(tokenHash).first<{ session_id: string }>())?.session_id ?? "";
      }
      if (!sessionId) throw Response.json({ error: "관리자 세션 식별자를 확인하지 못했습니다." }, { status: 503 });
      if (options?.stepUp && row.elevated_until <= now) {
        throw Response.json({
          error: "이 작업을 계속하려면 관리자 비밀번호와 OTP로 다시 인증해 주세요.",
          code: "step_up_required",
        }, { status: 428 });
      }
      return {
        environment,
        session: {
          email: row.admin_email,
          expiresAt: row.expires_at,
          sessionId,
          elevatedUntil: row.elevated_until,
          authMode: "session",
        },
        tokenHash,
      };
    }
  }
  if (token) throw Response.json({ error: "관리자 세션이 만료되었습니다." }, { status: 401 });
  throw Response.json({ error: "총관리자 로그인이 필요합니다." }, { status: 401 });
}

export async function logoutAdmin(request: Request) {
  const { environment, session, tokenHash } = await requireAdmin(request, { mutating: true });
  await environment.DB.batch([
    environment.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash),
    prepareAuditWrite(environment.DB, session.email, "admin.logout", "session", session.sessionId, {},
      { onlyIfPreviousStatementChanged: true }),
  ]);
  return expiredSessionCookie(request);
}

export async function stepUpAdmin(request: Request, payload: unknown) {
  const { environment, session, tokenHash } = await requireAdmin(request, { mutating: true });
  if (!payload || typeof payload !== "object") {
    throw Response.json({ error: "재인증 정보를 확인해 주세요." }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  const otp = typeof body.otp === "string" ? body.otp.replace(/\s/g, "") : "";
  if (!password || !/^\d{6}$/.test(otp)) {
    throw Response.json({ error: "비밀번호와 OTP 6자리를 입력해 주세요." }, { status: 400 });
  }

  const now = unixNow();
  const { credential: fingerprint, source: sourceFingerprint } = await stepUpFingerprints(request, tokenHash);
  const [attempt, sourceAttempt] = await Promise.all([
    loginAttempt(environment.DB, fingerprint),
    loginAttempt(environment.DB, sourceFingerprint),
  ]);
  if ((attempt && attempt.blocked_until > now) || (sourceAttempt && sourceAttempt.blocked_until > now)) {
    throw Response.json({ error: "재인증 시도가 잠겼습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
  }

  const localPreview = isLocalPreview(request, environment);
  if (!localPreview && (!isAdminPasswordHash(environment.ADMIN_PASSWORD_HASH) || !isTotpSecret(environment.ADMIN_TOTP_SECRET))) {
    throw Response.json({ error: "총관리자 인증 환경값이 올바르게 설정되지 않았습니다." }, { status: 503 });
  }
  const validPassword = localPreview
    ? await constantTimeEqualText(password, environment.ADMIN_LOCAL_PASSWORD ?? "")
    : await verifyAdminPassword(password, environment.ADMIN_PASSWORD_HASH ?? "");
  const validOtp = localPreview ? otp === "000000" : await verifyTotpCode(otp, environment.ADMIN_TOTP_SECRET ?? "");
  if (!validPassword || !validOtp) {
    const failures = await environment.DB.batch<{ failure_count: number; blocked_until: number }>([
      adminAuthFailureStatement(environment.DB, fingerprint, now, MAX_LOGIN_FAILURES),
      adminAuthFailureStatement(environment.DB, sourceFingerprint, now, MAX_LOGIN_FAILURES_PER_IP),
    ]);
    const failure = failures[0]?.results[0];
    const sourceFailure = failures[1]?.results[0];
    if (!failure || !sourceFailure) throw Response.json({ error: "재인증 제한 상태를 확인하지 못했습니다." }, { status: 503 });
    const blocked = failure.blocked_until > now || sourceFailure.blocked_until > now;
    await writeAudit(environment.DB, session.email, "admin.step_up.failed", "session", session.sessionId, {
      failureCount: failure.failure_count,
      sourceFailureCount: sourceFailure.failure_count,
    });
    throw Response.json({
      error: blocked ? "재인증 시도가 잠겼습니다. 15분 후 다시 시도해 주세요." : "관리자 인증 정보가 일치하지 않습니다.",
    }, { status: blocked ? 429 : 401 });
  }

  const elevatedUntil = Math.min(session.expiresAt, now + STEP_UP_SECONDS);
  const results = await environment.DB.batch([
    environment.DB.prepare("DELETE FROM admin_login_attempts WHERE fingerprint = ?").bind(fingerprint),
    environment.DB.prepare("DELETE FROM admin_login_attempts WHERE fingerprint = ?").bind(sourceFingerprint),
    environment.DB.prepare(`UPDATE admin_sessions SET elevated_until = ?, last_seen_at = ?
      WHERE token_hash = ? AND expires_at > ?`).bind(elevatedUntil, now, tokenHash, now),
    prepareAuditWrite(environment.DB, session.email, "admin.step_up.succeeded", "session", session.sessionId, {
      elevatedUntil,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  ]);
  if ((results[2]?.meta.changes ?? 0) !== 1) {
    throw Response.json({ error: "관리자 세션이 만료되었습니다." }, { status: 401 });
  }
  return { elevatedUntil };
}

export async function listAdminSessions(request: Request): Promise<AdminSessionSummary[]> {
  const { environment, session } = await requireAdmin(request);
  const now = unixNow();
  const rows = await environment.DB.prepare(`SELECT session_id, created_at, expires_at, last_seen_at,
    elevated_until, source_ip_masked, user_agent_label
    FROM admin_sessions WHERE admin_email = ? AND expires_at > ?
    ORDER BY CASE WHEN session_id = ? THEN 0 ELSE 1 END, last_seen_at DESC`)
    .bind(session.email, now, session.sessionId)
    .all<{
      session_id: string | null; created_at: number; expires_at: number; last_seen_at: number;
      elevated_until: number; source_ip_masked: string; user_agent_label: string;
    }>();
  return rows.results.flatMap((row) => row.session_id ? [{
    sessionId: row.session_id,
    current: row.session_id === session.sessionId,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    elevatedUntil: row.elevated_until,
    sourceIpMasked: row.source_ip_masked || "기록 없음",
    userAgentLabel: row.user_agent_label || "알 수 없는 기기",
  }] : []);
}

export async function revokeAdminSessions(request: Request, payload: unknown) {
  const { environment, session, tokenHash } = await requireAdmin(request, { mutating: true, stepUp: true });
  if (!payload || typeof payload !== "object") {
    throw Response.json({ error: "해지할 세션을 선택해 주세요." }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;
  const allOthers = body.allOthers === true;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim().toLowerCase() : "";
  if (allOthers === Boolean(sessionId)) {
    throw Response.json({ error: "세션 하나 또는 다른 모든 세션 중 하나만 선택해 주세요." }, { status: 400 });
  }
  const now = unixNow();
  if (allOthers) {
    const results = await environment.DB.batch([
      environment.DB.prepare(`DELETE FROM admin_sessions
        WHERE admin_email = ? AND token_hash <> ?`).bind(session.email, tokenHash),
      prepareAuditWrite(environment.DB, session.email, "admin.sessions.revoked_others", "session", session.sessionId, {
        requestedAt: now,
      }, { createdAt: now }),
    ]);
    const revokedCount = Math.max(0, Number(results[0]?.meta.changes ?? 0));
    const realtimeDisconnected = revokedCount > 0
      ? await disconnectChatPrincipal(environment, { role: "admin", principalEmail: session.email }).catch(() => 0)
      : 0;
    return { revokedCount, realtimeDisconnected };
  }
  if (!/^[a-f0-9]{32}$/.test(sessionId)) {
    throw Response.json({ error: "세션 식별자가 올바르지 않습니다." }, { status: 400 });
  }
  if (sessionId === session.sessionId) {
    throw Response.json({ error: "현재 세션은 로그아웃 버튼으로 종료해 주세요." }, { status: 409 });
  }
  const results = await environment.DB.batch([
    environment.DB.prepare(`DELETE FROM admin_sessions
      WHERE admin_email = ? AND session_id = ? AND token_hash <> ?`).bind(session.email, sessionId, tokenHash),
    prepareAuditWrite(environment.DB, session.email, "admin.session.revoked", "session", sessionId, {
      requestedBySessionId: session.sessionId,
    }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
  ]);
  const revokedCount = Math.max(0, Number(results[0]?.meta.changes ?? 0));
  if (revokedCount !== 1) return { revokedCount: 0 };
  const realtimeDisconnected = await disconnectChatPrincipal(environment, {
    role: "admin",
    principalEmail: session.email,
  }).catch(() => 0);
  return { revokedCount, realtimeDisconnected };
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

function configuredAdminEmail(request: Request, environment: AdminEnvironment) {
  return (isLocalPreview(request, environment) ? "admin@minecraft.kr" : environment.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

function parseUnixTimestamp(value: string | undefined) {
  if (!value || !/^\d{10}$/.test(value)) return 0;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : 0;
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

async function loginFingerprints(request: Request, email: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const source = ip.trim();
  const [credential, sourceFingerprint] = await Promise.all([
    sha256Hex(`${source}|${email.slice(0, 254)}`),
    sha256Hex(`source|${source}`),
  ]);
  return { credential, source: sourceFingerprint };
}

async function stepUpFingerprints(request: Request, tokenHash: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const source = ip.trim();
  const [credential, sourceFingerprint] = await Promise.all([
    sha256Hex(`step-up|${tokenHash}|${source}`),
    sha256Hex(`step-up-source|${source}`),
  ]);
  return { credential, source: sourceFingerprint };
}

async function loginAttempt(db: D1Database, fingerprint: string) {
  return db.prepare("SELECT failure_count, blocked_until, updated_at FROM admin_login_attempts WHERE fingerprint = ?")
    .bind(fingerprint)
    .first<{ failure_count: number; blocked_until: number; updated_at: number }>();
}

function adminAuthFailureStatement(db: D1Database, fingerprint: string, now: number, failureLimit: number) {
  return db.prepare(`INSERT INTO admin_login_attempts
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
    .bind(fingerprint, now, failureLimit, now + LOGIN_BLOCK_SECONDS);
}

function adminUserAgentLabel(request: Request) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const browser = userAgent.includes("Edg/") ? "Edge"
    : userAgent.includes("Firefox/") ? "Firefox"
      : userAgent.includes("Chrome/") || userAgent.includes("CriOS/") ? "Chrome"
        : userAgent.includes("Safari/") ? "Safari"
          : userAgent ? "기타 브라우저" : "알 수 없는 브라우저";
  const platform = userAgent.includes("iPhone") || userAgent.includes("iPad") ? "iOS"
    : userAgent.includes("Android") ? "Android"
      : userAgent.includes("Mac OS X") ? "macOS"
        : userAgent.includes("Windows") ? "Windows"
          : userAgent.includes("Linux") ? "Linux"
            : "알 수 없는 OS";
  return `${browser} · ${platform}`;
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

function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
