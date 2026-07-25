import { prepareAuditWrite } from "@/lib/admin-security";

export const ADMIN_FEATURE_DEFINITIONS = [
  { key: "public_writes", label: "전체 공개 쓰기", description: "관리자·인증·상태 확인·방문자 집계를 제외한 모든 공개 쓰기 요청" },
  { key: "server_registration", label: "서버 신규 등록", description: "서버 운영자의 신규 서버 등록" },
  { key: "server_management", label: "서버 정보 변경", description: "등록 서버의 정보 수정과 삭제" },
  { key: "media_uploads", label: "서버 미디어", description: "아이콘·배너·배경·소개 포스터 업로드, 크롭 변경과 삭제" },
  { key: "ownership", label: "소유권 이전·주장", description: "서버 소유권 양도, 주장, 인증과 수락" },
  { key: "votes", label: "서버 추천", description: "공개 서버 추천 등록" },
  { key: "messaging", label: "운영 메시지", description: "총관리자 직통라인, 운영자 채널과 소유자 실시간 티켓" },
  { key: "premium_bids", label: "프리미엄 입찰", description: "서버 운영자의 프리미엄 경매 입찰" },
  { key: "bridge_provisioning", label: "Bridge 연결·인증", description: "Bridge 신규 연결과 소유권 검증" },
  { key: "bridge_telemetry", label: "Bridge 실시간 수집", description: "Bridge 플레이어·백엔드 상태 수집" },
] as const;

export type AdminFeatureKey = (typeof ADMIN_FEATURE_DEFINITIONS)[number]["key"];
export type AdminFeatureMode = "enabled" | "disabled";

export const ADMIN_JOB_DEFINITIONS = [
  { key: "public_status_snapshots", label: "공개 서버 상태 수집", expectedIntervalSeconds: 300 },
  { key: "application_retention_cleanup", label: "개인정보·만료 데이터 정리", expectedIntervalSeconds: 300 },
  { key: "server_quarantine_purge", label: "서버 격리 만료 정리", expectedIntervalSeconds: 300 },
  { key: "broadcast_cache_cleanup", label: "방송 이미지 캐시 정리", expectedIntervalSeconds: 300 },
] as const;

export type AdminJobKey = (typeof ADMIN_JOB_DEFINITIONS)[number]["key"];
export type AdminJobTrigger = "scheduled" | "manual";
export type OperationalCheckStatus = "healthy" | "warning" | "critical" | "unknown";

type FeatureControlRow = {
  feature_key: string;
  mode: string;
  reason: string;
  expires_at: number | null;
  updated_by: string;
  updated_at: number;
};

type JobStatusRow = {
  job_key: string;
  last_started_at: number | null;
  last_succeeded_at: number | null;
  last_failed_at: number | null;
  last_duration_ms: number | null;
  last_error: string;
  last_result: string;
  run_count: number;
  failure_count: number;
  updated_at: number;
};

type OperationalCheckRow = {
  check_key: string;
  status: string;
  note: string;
  checked_by: string;
  checked_at: number;
  valid_until: number | null;
};

export type AdminFeatureControl = {
  featureKey: AdminFeatureKey;
  label: string;
  description: string;
  mode: AdminFeatureMode;
  configuredMode: AdminFeatureMode;
  reason: string;
  expiresAt: number | null;
  expired: boolean;
  updatedBy: string;
  updatedAt: number | null;
};

export type AdminJobStatus = {
  jobKey: AdminJobKey;
  label: string;
  expectedIntervalSeconds: number;
  status: "healthy" | "running" | "failing" | "stale" | "never_run";
  lastStartedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  lastDurationMs: number | null;
  lastError: string;
  lastResult: unknown;
  runCount: number;
  consecutiveFailures: number;
  nextExpectedAt: number | null;
  updatedAt: number | null;
};

export type AdminOperationalCheck = {
  checkKey: string;
  status: OperationalCheckStatus;
  configuredStatus: OperationalCheckStatus;
  note: string;
  checkedBy: string;
  checkedAt: number;
  validUntil: number | null;
  expired: boolean;
};

export type ActiveFeatureBlock = {
  featureKey: AdminFeatureKey;
  expiresAt: number | null;
};

const FEATURE_KEYS = new Set<string>(ADMIN_FEATURE_DEFINITIONS.map((item) => item.key));
const JOB_KEYS = new Set<string>(ADMIN_JOB_DEFINITIONS.map((item) => item.key));
const CHECK_STATUSES = new Set<OperationalCheckStatus>(["healthy", "warning", "critical", "unknown"]);
const MAX_CONTROL_SECONDS = 30 * 86_400;
const JOB_STALE_SECONDS = 15 * 60;
const JOB_LEASE_SECONDS = 15 * 60;
const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

export async function ensureAdminOperationsSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  const key = db as unknown as object;
  const pending = schemaReadyByDatabase.get(key);
  if (pending) return pending;
  const ready = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_feature_controls (
      feature_key TEXT PRIMARY KEY NOT NULL,
      mode TEXT NOT NULL DEFAULT 'enabled' CHECK (mode IN ('enabled', 'disabled')),
      reason TEXT NOT NULL DEFAULT '',
      expires_at INTEGER,
      updated_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_job_statuses (
      job_key TEXT PRIMARY KEY NOT NULL,
      last_started_at INTEGER,
      last_succeeded_at INTEGER,
      last_failed_at INTEGER,
      last_duration_ms INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      last_result TEXT NOT NULL DEFAULT '{}',
      run_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_operational_checks (
      check_key TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'warning', 'critical', 'unknown')),
      note TEXT NOT NULL DEFAULT '',
      checked_by TEXT NOT NULL,
      checked_at INTEGER NOT NULL,
      valid_until INTEGER
    )`),
  ]).then(async () => {
    const now = unixNow();
    await db.batch(ADMIN_JOB_DEFINITIONS.map((job) => db.prepare(`INSERT OR IGNORE INTO admin_job_statuses
      (job_key, last_started_at, last_succeeded_at, last_failed_at, last_duration_ms,
        last_error, last_result, run_count, failure_count, updated_at)
      VALUES (?, NULL, NULL, NULL, NULL, '', '{}', 0, 0, ?)`).bind(job.key, now)));
  }).catch((error) => {
    schemaReadyByDatabase.delete(key);
    throw error;
  });
  schemaReadyByDatabase.set(key, ready);
  return ready;
}

export function isAdminFeatureKey(value: unknown): value is AdminFeatureKey {
  return typeof value === "string" && FEATURE_KEYS.has(value);
}

export function isAdminJobKey(value: unknown): value is AdminJobKey {
  return typeof value === "string" && JOB_KEYS.has(value);
}

export async function expireFeatureControls(db: D1Database, now = unixNow()) {
  await ensureAdminOperationsSchema(db);
  const expired = await db.prepare(`SELECT feature_key, reason, expires_at FROM admin_feature_controls
    WHERE mode = 'disabled' AND expires_at IS NOT NULL AND expires_at <= ?`).bind(now)
    .all<{ feature_key: string; reason: string; expires_at: number }>();
  if (expired.results.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  for (const control of expired.results) {
    statements.push(
      db.prepare(`UPDATE admin_feature_controls SET mode = 'enabled', expires_at = NULL,
        updated_by = 'system@minecraft.kr', updated_at = ?
        WHERE feature_key = ? AND mode = 'disabled' AND expires_at IS NOT NULL AND expires_at <= ?`)
        .bind(now, control.feature_key, now),
      prepareAuditWrite(db, "system@minecraft.kr", "operations.feature.expired", "feature_control", control.feature_key, {
        reason: control.reason,
        scheduledExpiry: control.expires_at,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    );
  }
  const results = await db.batch(statements);
  return results.reduce((count, result, index) => count + (index % 2 === 0 ? Number(result.meta.changes ?? 0) : 0), 0);
}

export async function listFeatureControls(db: D1Database, now = unixNow()): Promise<AdminFeatureControl[]> {
  await ensureAdminOperationsSchema(db);
  await expireFeatureControls(db, now);
  const rows = await db.prepare(`SELECT feature_key, mode, reason, expires_at, updated_by, updated_at
    FROM admin_feature_controls`).all<FeatureControlRow>();
  const byKey = new Map(rows.results.map((row) => [row.feature_key, row]));
  return ADMIN_FEATURE_DEFINITIONS.map((definition) => {
    const row = byKey.get(definition.key);
    const configuredMode = row?.mode === "disabled" ? "disabled" : "enabled";
    const expired = configuredMode === "disabled" && row?.expires_at != null && row.expires_at <= now;
    return {
      featureKey: definition.key,
      label: definition.label,
      description: definition.description,
      mode: expired ? "enabled" : configuredMode,
      configuredMode,
      reason: row?.reason ?? "",
      expiresAt: row?.expires_at ?? null,
      expired,
      updatedBy: row?.updated_by ?? "",
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export async function activeFeatureBlock(
  db: D1Database,
  featureKey: AdminFeatureKey,
  now = unixNow(),
): Promise<ActiveFeatureBlock | null> {
  await ensureAdminOperationsSchema(db);
  const keys = featureKey === "public_writes" ? ["public_writes"] : ["public_writes", featureKey];
  const placeholders = keys.map(() => "?").join(",");
  const row = await db.prepare(`SELECT feature_key, expires_at FROM admin_feature_controls
    WHERE feature_key IN (${placeholders}) AND mode = 'disabled'
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY CASE feature_key WHEN 'public_writes' THEN 0 ELSE 1 END
    LIMIT 1`).bind(...keys, now).first<{ feature_key: string; expires_at: number | null }>();
  return row && isAdminFeatureKey(row.feature_key)
    ? { featureKey: row.feature_key, expiresAt: row.expires_at }
    : null;
}

export async function updateFeatureControl(
  db: D1Database,
  actorEmail: string,
  input: { featureKey: unknown; mode: unknown; reason?: unknown; expiresAt?: unknown },
  now = unixNow(),
) {
  await ensureAdminOperationsSchema(db);
  if (!isAdminFeatureKey(input.featureKey)) throw badRequest("지원하지 않는 기능 제어 항목입니다.");
  const mode = input.mode === "enabled" ? "enabled" : input.mode === "disabled" ? "disabled" : null;
  if (!mode) throw badRequest("기능 상태는 enabled 또는 disabled여야 합니다.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (mode === "disabled" && reason.length < 3) throw badRequest("기능 중지 사유를 3자 이상 입력해 주세요.");
  const expiresAt = mode === "disabled" ? optionalFutureTimestamp(input.expiresAt, now) : null;
  const action = mode === "disabled" ? "operations.feature.disabled" : "operations.feature.enabled";
  await db.batch([
    db.prepare(`INSERT INTO admin_feature_controls
      (feature_key, mode, reason, expires_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(feature_key) DO UPDATE SET mode = excluded.mode, reason = excluded.reason,
        expires_at = excluded.expires_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(input.featureKey, mode, reason, expiresAt, actorEmail, now),
    prepareAuditWrite(db, actorEmail, action, "feature_control", input.featureKey, {
      mode,
      reason,
      expiresAt,
    }, { createdAt: now }),
  ]);
  return (await listFeatureControls(db, now)).find((control) => control.featureKey === input.featureKey) as AdminFeatureControl;
}

export async function listJobStatuses(db: D1Database, now = unixNow()): Promise<AdminJobStatus[]> {
  await ensureAdminOperationsSchema(db);
  const rows = await db.prepare(`SELECT job_key, last_started_at, last_succeeded_at, last_failed_at,
    last_duration_ms, last_error, last_result, run_count, failure_count, updated_at
    FROM admin_job_statuses`).all<JobStatusRow>();
  const byKey = new Map(rows.results.map((row) => [row.job_key, row]));
  return ADMIN_JOB_DEFINITIONS.map((definition) => {
    const row = byKey.get(definition.key);
    const lastStartedAt = row?.last_started_at ?? null;
    const lastSucceededAt = row?.last_succeeded_at ?? null;
    const lastFailedAt = row?.last_failed_at ?? null;
    const lastResult = parseJson(row?.last_result);
    const running = lastStartedAt != null
      && isRecord(lastResult) && lastResult.status === "running"
      && lastStartedAt > now - JOB_LEASE_SECONDS;
    const status = running
      ? "running"
      : lastFailedAt != null && lastFailedAt > (lastSucceededAt ?? 0)
        ? "failing"
        : lastSucceededAt == null
          ? "never_run"
          : lastSucceededAt < now - JOB_STALE_SECONDS
            ? "stale"
            : "healthy";
    return {
      jobKey: definition.key,
      label: definition.label,
      expectedIntervalSeconds: definition.expectedIntervalSeconds,
      status,
      lastStartedAt,
      lastSucceededAt,
      lastFailedAt,
      lastDurationMs: row?.last_duration_ms ?? null,
      lastError: row?.last_error ?? "",
      lastResult,
      runCount: Number(row?.run_count ?? 0),
      consecutiveFailures: Number(row?.failure_count ?? 0),
      nextExpectedAt: lastSucceededAt == null ? null : lastSucceededAt + definition.expectedIntervalSeconds,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export async function listOperationalChecks(db: D1Database, now = unixNow()): Promise<AdminOperationalCheck[]> {
  await ensureAdminOperationsSchema(db);
  const rows = await db.prepare(`SELECT check_key, status, note, checked_by, checked_at, valid_until
    FROM admin_operational_checks ORDER BY check_key`).all<OperationalCheckRow>();
  return rows.results.map((row) => {
    const configuredStatus = CHECK_STATUSES.has(row.status as OperationalCheckStatus)
      ? row.status as OperationalCheckStatus
      : "unknown";
    const expired = row.valid_until != null && row.valid_until <= now;
    return {
      checkKey: row.check_key,
      status: expired ? "unknown" : configuredStatus,
      configuredStatus,
      note: row.note,
      checkedBy: row.checked_by,
      checkedAt: row.checked_at,
      validUntil: row.valid_until,
      expired,
    };
  });
}

export async function updateOperationalCheck(
  db: D1Database,
  actorEmail: string,
  input: { checkKey: unknown; status: unknown; note?: unknown; validUntil?: unknown },
  now = unixNow(),
) {
  await ensureAdminOperationsSchema(db);
  const checkKey = typeof input.checkKey === "string" ? input.checkKey.trim() : "";
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(checkKey) || checkKey.startsWith("job.")) {
    throw badRequest("운영 확인 키가 올바르지 않거나 시스템 전용 항목입니다.");
  }
  if (typeof input.status !== "string" || !CHECK_STATUSES.has(input.status as OperationalCheckStatus)) {
    throw badRequest("운영 확인 상태가 올바르지 않습니다.");
  }
  const status = input.status as OperationalCheckStatus;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  const validUntil = optionalFutureTimestamp(input.validUntil, now);
  await db.batch([
    db.prepare(`INSERT INTO admin_operational_checks
      (check_key, status, note, checked_by, checked_at, valid_until)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(check_key) DO UPDATE SET status = excluded.status, note = excluded.note,
        checked_by = excluded.checked_by, checked_at = excluded.checked_at, valid_until = excluded.valid_until`)
      .bind(checkKey, status, note, actorEmail, now, validUntil),
    prepareAuditWrite(db, actorEmail, "operations.check.updated", "operational_check", checkKey, {
      status,
      note,
      validUntil,
    }, { createdAt: now }),
  ]);
  return (await listOperationalChecks(db, now)).find((check) => check.checkKey === checkKey) as AdminOperationalCheck;
}

export async function operationsSnapshot(db: D1Database, now = unixNow()) {
  const [controls, jobs, checks] = await Promise.all([
    listFeatureControls(db, now),
    listJobStatuses(db, now),
    listOperationalChecks(db, now),
  ]);
  return {
    controls,
    jobs,
    checks,
    featureKeys: ADMIN_FEATURE_DEFINITIONS.map((item) => item.key),
    jobKeys: ADMIN_JOB_DEFINITIONS.map((item) => item.key),
    generatedAt: now,
  };
}

export async function runTrackedAdminJob<T>(
  db: D1Database,
  jobKey: AdminJobKey,
  trigger: AdminJobTrigger,
  work: () => Promise<T>,
): Promise<{ status: "succeeded"; result: T; durationMs: number } | { status: "skipped"; result: null; durationMs: 0 }> {
  await ensureAdminOperationsSchema(db);
  const startedAt = unixNow();
  const startedMs = Date.now();
  const runId = crypto.randomUUID().replaceAll("-", "");
  const runningMarker = stringifyJson({ status: "running", runId, trigger });
  const claimed = await db.prepare(`UPDATE admin_job_statuses
    SET last_started_at = ?, last_result = ?, last_error = '', run_count = run_count + 1, updated_at = ?
    WHERE job_key = ? AND (
      last_started_at IS NULL
      OR last_result NOT LIKE '{"status":"running"%'
      OR last_started_at <= ?
    )`).bind(startedAt, runningMarker, startedAt, jobKey, startedAt - JOB_LEASE_SECONDS).run();
  if (!claimed.meta.changes) return { status: "skipped", result: null, durationMs: 0 };

  try {
    const result = await work();
    const finishedAt = unixNow();
    const durationMs = Math.max(0, Date.now() - startedMs);
    const resultJson = stringifyJson({ status: "succeeded", trigger, result });
    const completed = await db.batch([
      db.prepare(`UPDATE admin_job_statuses SET last_succeeded_at = ?, last_duration_ms = ?,
        last_error = '', last_result = ?, failure_count = 0, updated_at = ?
        WHERE job_key = ? AND last_result = ?`)
        .bind(finishedAt, durationMs, resultJson, finishedAt, jobKey, runningMarker),
      operationalCheckStatement(db, `job.${jobKey}`, "healthy", "최근 예약 작업이 정상 완료되었습니다.",
        "system@minecraft.kr", finishedAt, finishedAt + JOB_STALE_SECONDS, true),
    ]);
    if ((completed[0]?.meta.changes ?? 0) !== 1) {
      throw new Error("작업 실행 lease가 만료되거나 다른 실행으로 교체되었습니다.");
    }
    return { status: "succeeded", result, durationMs };
  } catch (error) {
    const failedAt = unixNow();
    const durationMs = Math.max(0, Date.now() - startedMs);
    const message = safeErrorMessage(error);
    const resultJson = stringifyJson({ status: "failed", trigger });
    await db.batch([
      db.prepare(`UPDATE admin_job_statuses SET last_failed_at = ?, last_duration_ms = ?,
        last_error = ?, last_result = ?, failure_count = failure_count + 1, updated_at = ?
        WHERE job_key = ? AND last_result = ?`)
        .bind(failedAt, durationMs, message, resultJson, failedAt, jobKey, runningMarker),
      operationalCheckStatement(db, `job.${jobKey}`, "critical", message,
        "system@minecraft.kr", failedAt, failedAt + JOB_STALE_SECONDS, true),
    ]);
    throw error;
  }
}

function operationalCheckStatement(
  db: D1Database,
  checkKey: string,
  status: OperationalCheckStatus,
  note: string,
  checkedBy: string,
  checkedAt: number,
  validUntil: number | null,
  onlyIfPreviousStatementChanged = false,
) {
  return db.prepare(`INSERT INTO admin_operational_checks
    (check_key, status, note, checked_by, checked_at, valid_until)
    ${onlyIfPreviousStatementChanged ? "SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1" : "VALUES (?, ?, ?, ?, ?, ?)"}
    ON CONFLICT(check_key) DO UPDATE SET status = excluded.status, note = excluded.note,
      checked_by = excluded.checked_by, checked_at = excluded.checked_at, valid_until = excluded.valid_until`)
    .bind(checkKey, status, note.slice(0, 500), checkedBy, checkedAt, validUntil);
}

function optionalFutureTimestamp(value: unknown, now: number) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= now || parsed > now + MAX_CONTROL_SECONDS) {
    throw badRequest("만료 시각은 현재부터 30일 이내의 미래 시각이어야 합니다.");
  }
  return parsed;
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function parseJson(value: string | undefined) {
  try {
    return JSON.parse(value ?? "{}");
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 5000);
  } catch {
    return "{}";
  }
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "알 수 없는 작업 오류";
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "알 수 없는 작업 오류";
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
