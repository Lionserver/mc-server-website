"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DatabaseBackup,
  Download,
  KeyRound,
  Laptop,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundX,
} from "lucide-react";

export type AdminWorkRunner = (work: () => Promise<void>, message: string) => Promise<void>;

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type Account = {
  id: string;
  email: string;
  emailVerifiedAt: number;
  lastLoginAt: number;
  identityVerificationStatus: string;
  identityVerifiedAt: number | null;
  identityProvider: string;
  identityReferenceMasked: string;
  accountStatus: "active" | "suspended";
  suspendedAt: number | null;
  suspendedBy: string | null;
  suspensionReason: string;
  createdAt: number;
  updatedAt: number;
};
type AuditEntry = {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: number;
};
type AdminSessionItem = {
  sessionId: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  elevatedUntil: number;
  sourceIpMasked: string;
  userAgentLabel: string;
};
type FeatureControl = {
  featureKey: string;
  label: string;
  description: string;
  mode: "enabled" | "disabled";
  reason: string;
  expiresAt: number | null;
  updatedBy: string;
  updatedAt: number;
};
type JobStatus = {
  jobKey: string;
  label: string;
  status: "healthy" | "running" | "failing" | "stale" | "never_run";
  lastStartedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  lastDurationMs: number | null;
  lastError: string;
  lastResult: Record<string, unknown>;
  runCount: number;
  consecutiveFailures: number;
  updatedAt: number | null;
};
type OperationalCheck = {
  checkKey: string;
  status: "healthy" | "warning" | "critical" | "unknown";
  note: string;
  checkedBy: string;
  checkedAt: number;
  validUntil: number | null;
};
type OperationsPayload = {
  controls: FeatureControl[];
  jobs: JobStatus[];
  checks: OperationalCheck[];
  featureKeys: string[];
  jobKeys: string[];
  generatedAt: number;
};

const dateTime = (unix: number | null) => unix
  ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(unix * 1000)
  : "-";
const toUnix = (value: string) => value ? Math.floor(new Date(value).getTime() / 1000) : null;
const featureLabels: Record<string, string> = {
  public_writes: "전체 공개 쓰기",
  server_registration: "서버 신규 등록",
  server_management: "서버 정보 수정",
  votes: "추천 참여",
  media_uploads: "이미지 업로드",
  premium_bids: "프리미엄·경매",
  messaging: "운영자 메시지",
  ownership: "소유권 이전·주장",
  bridge_provisioning: "브리지 연결·인증",
  bridge_telemetry: "브리지 실시간 수집",
};
const jobLabels: Record<string, string> = {
  public_status_snapshots: "서버 상태 스냅샷",
  application_retention_cleanup: "개인정보 보존기간 정리",
  server_quarantine_purge: "서버 격리 만료 정리",
  broadcast_cache_cleanup: "방송 이미지 캐시 정리",
};
const checkLabels: Record<string, string> = {
  backup_snapshot: "최근 백업 스냅샷",
  restore_drill: "복구 리허설",
};

export function PaginatedIdentityControl({
  busy,
  secureRun,
  refreshOverview,
}: {
  busy: boolean;
  secureRun: AdminWorkRunner;
  refreshOverview: () => Promise<void>;
}) {
  const [items, setItems] = useState<Account[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [identityStatus, setIdentityStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (query) params.set("q", query);
    if (accountStatus) params.set("accountStatus", accountStatus);
    if (identityStatus) params.set("identityStatus", identityStatus);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/accounts?${params}`, { cache: "no-store" });
      const body = await response.json() as { items?: Account[]; pagination?: Pagination; error?: string };
      if (!response.ok || !body.items || !body.pagination) throw new Error(body.error || "계정 목록을 불러오지 못했습니다.");
      setItems(body.items);
      setPagination(body.pagination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "계정 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [accountStatus, identityStatus, page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  };
  const verify = (account: Account) => {
    const provider = window.prompt("본인인증 제공자명(PASS, NICE 등)을 입력하세요.", account.identityProvider || "PASS");
    if (!provider?.trim()) return;
    const reference = window.prompt("인증 결과 확인번호를 입력하세요.", "");
    if (!reference?.trim()) return;
    void secureRun(async () => {
      await jsonRequest(`/api/admin/identity/${account.id}`, "PATCH", {
        action: "verify",
        provider: provider.trim(),
        reference: reference.trim(),
      });
      await Promise.all([load(), refreshOverview()]);
    }, `${account.email} 계정의 본인인증을 승인했습니다.`);
  };
  const revokeIdentity = (account: Account) => {
    if (!window.confirm(`${account.email} 본인인증을 철회할까요? 진행 중 입찰과 프리미엄 노출도 중단됩니다.`)) return;
    void secureRun(async () => {
      await jsonRequest(`/api/admin/identity/${account.id}`, "PATCH", { action: "revoke" });
      await Promise.all([load(), refreshOverview()]);
    }, `${account.email} 계정의 본인인증을 철회했습니다.`);
  };
  const toggleAccount = (account: Account) => {
    const suspending = account.accountStatus !== "suspended";
    let reason = "";
    if (suspending) {
      reason = window.prompt("계정 정지 사유를 입력하세요. 기존 로그인 세션이 모두 종료됩니다.", account.suspensionReason)?.trim() ?? "";
      if (reason.length < 3) return;
    } else if (!window.confirm(`${account.email} 계정의 이용 정지를 해제할까요?`)) {
      return;
    }
    void secureRun(async () => {
      await jsonRequest(`/api/admin/accounts/${account.id}`, "PATCH", {
        action: suspending ? "suspend" : "restore",
        reason,
      });
      await Promise.all([load(), refreshOverview()]);
    }, suspending ? `${account.email} 계정을 정지하고 모든 세션을 해지했습니다.` : `${account.email} 계정을 복구했습니다.`);
  };

  return <section className="admin-panel admin-wide-panel" aria-busy={loading}>
    <div className="admin-section-head">
      <div><span className="admin-eyebrow">IDENTITY & ACCOUNT GATE</span><h2>운영자 계정·본인인증</h2><p>검색 결과 전체를 페이지 단위로 검토하고, 계정 정지 시 로그인 세션을 즉시 종료합니다.</p></div>
      <span>총 {pagination.total.toLocaleString()}개</span>
    </div>
    <form className="admin-list-toolbar" onSubmit={submitSearch}>
      <label className="query"><span>계정 검색</span><div><Search size={15} /><input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="이메일 또는 계정 ID" /></div></label>
      <label><span>계정 상태</span><select value={accountStatus} onChange={(event) => { setAccountStatus(event.target.value); setPage(1); }}><option value="">전체</option><option value="active">정상</option><option value="suspended">정지</option></select></label>
      <label><span>본인인증</span><select value={identityStatus} onChange={(event) => { setIdentityStatus(event.target.value); setPage(1); }}><option value="">전체</option><option value="verified">인증</option><option value="unverified">미인증</option></select></label>
      <button className="admin-primary" type="submit">검색</button>
      <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} />갱신</button>
    </form>
    {error && <div className="admin-form-error" role="alert">{error}</div>}
    <div className="admin-table-wrap"><table className="admin-account-table"><thead><tr><th>이메일 계정</th><th>계정 상태</th><th>본인인증</th><th>제공자 / 확인번호</th><th>최근 로그인</th><th>관리</th></tr></thead><tbody>
      {loading && items.length === 0 ? <tr><td colSpan={6}>계정 목록을 불러오는 중입니다.</td></tr> : items.length === 0 ? <tr><td colSpan={6}>조건에 맞는 운영자 계정이 없습니다.</td></tr> : items.map((account) => <tr key={account.id}>
        <td><b>{account.email}</b><small>{account.id}</small></td>
        <td><Status value={account.accountStatus} />{account.accountStatus === "suspended" && <small>{account.suspensionReason || "사유 미입력"} · {dateTime(account.suspendedAt)}</small>}</td>
        <td><Status value={account.identityVerificationStatus} /><small>{dateTime(account.identityVerifiedAt)}</small></td>
        <td>{account.identityProvider || "-"}<small>{account.identityReferenceMasked || "확인번호 없음"}</small></td>
        <td>{dateTime(account.lastLoginAt)}</td>
        <td><div className="admin-row-actions">{account.identityVerificationStatus === "verified"
          ? <button className="admin-inline-danger" disabled={busy} onClick={() => revokeIdentity(account)}>인증 철회</button>
          : <button disabled={busy || account.accountStatus === "suspended"} onClick={() => verify(account)}>인증 승인</button>}
          <button className={account.accountStatus === "suspended" ? "" : "admin-inline-danger"} disabled={busy} onClick={() => toggleAccount(account)}>{account.accountStatus === "suspended" ? "정지 해제" : "계정 정지"}</button></div>
        </td>
      </tr>)}
    </tbody></table></div>
    <PaginationBar pagination={pagination} loading={loading} onPage={setPage} />
  </section>;
}

export function AdminAuditControl() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: "", adminEmail: "", action: "", targetType: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [exportNotice, setExportNotice] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    for (const [key, value] of Object.entries(applied)) {
      if (!value.trim()) continue;
      if (key === "from" || key === "to") {
        const unix = toUnix(value);
        if (unix) params.set(key, String(unix));
      } else {
        params.set(key, value.trim());
      }
    }
    return params.toString();
  }, [applied, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/audits?${queryString}`, { cache: "no-store" });
      const body = await response.json() as { items?: AuditEntry[]; pagination?: Pagination; error?: string };
      if (!response.ok || !body.items || !body.pagination) throw new Error(body.error || "감사 로그를 불러오지 못했습니다.");
      setItems(body.items);
      setPagination(body.pagination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "감사 로그를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  };
  const exportCsv = async () => {
    setExporting(true);
    setError("");
    setExportNotice("");
    try {
      const params = new URLSearchParams(queryString);
      params.set("format", "csv");
      params.delete("page");
      params.delete("limit");
      const response = await fetch(`/api/admin/audits?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "감사 로그를 내보내지 못했습니다.");
      }
      const truncated = response.headers.get("X-Export-Truncated") === "true";
      const exportLimit = Number(response.headers.get("X-Export-Limit") ?? 10_000);
      const exportTotal = Number(response.headers.get("X-Export-Total") ?? 0);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `minecraft-kr-admin-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNotice(truncated
        ? `검색 결과 ${exportTotal.toLocaleString()}건 중 최신 ${exportLimit.toLocaleString()}건을 내려받았습니다. 기간 조건을 좁혀 나머지를 분할 내보내세요.`
        : `${exportTotal.toLocaleString()}건의 감사 로그를 CSV로 내려받았습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "감사 로그를 내보내지 못했습니다.");
    } finally {
      setExporting(false);
    }
  };

  return <section className="admin-panel admin-wide-panel" aria-busy={loading}>
    <div className="admin-section-head">
      <div><span className="admin-eyebrow">IMMUTABLE TRAIL</span><h2>관리자 감사 로그</h2><p>관리자·작업·대상·기간을 조합해 전체 이력을 검색하고 같은 조건으로 CSV를 내려받습니다.</p></div>
      <span>총 {pagination.total.toLocaleString()}건</span>
    </div>
    <form className="admin-audit-toolbar" onSubmit={submit}>
      <label className="query"><span>통합 검색</span><div><Search size={15} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="관리자, 작업, 대상 ID" /></div></label>
      <label><span>관리자</span><input value={filters.adminEmail} onChange={(event) => setFilters((current) => ({ ...current, adminEmail: event.target.value }))} placeholder="admin@example.com" /></label>
      <label><span>작업</span><input value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))} placeholder="server.deleted" /></label>
      <label><span>대상 유형</span><input value={filters.targetType} onChange={(event) => setFilters((current) => ({ ...current, targetType: event.target.value }))} placeholder="server" /></label>
      <label><span>시작</span><input type="datetime-local" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
      <label><span>종료</span><input type="datetime-local" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
      <button className="admin-primary" type="submit">검색</button>
      <button type="button" onClick={() => void exportCsv()} disabled={exporting}><Download size={14} />{exporting ? "생성 중" : "CSV"}</button>
    </form>
    {error && <div className="admin-form-error" role="alert">{error}</div>}
    {exportNotice && <div className="admin-vote-action-notice" role="status"><Download size={15} />{exportNotice}</div>}
    <div className="admin-table-wrap"><table className="admin-audit-table"><thead><tr><th>시각</th><th>관리자</th><th>작업</th><th>대상</th><th>상세</th></tr></thead><tbody>
      {loading && items.length === 0 ? <tr><td colSpan={5}>감사 로그를 불러오는 중입니다.</td></tr> : items.length === 0 ? <tr><td colSpan={5}>조건에 맞는 감사 로그가 없습니다.</td></tr> : items.map((entry) => <tr key={entry.id}>
        <td>{dateTime(entry.createdAt)}</td>
        <td>{entry.adminEmail}</td>
        <td><code>{entry.action}</code></td>
        <td>{entry.targetType}<small>{entry.targetId}</small></td>
        <td><details className="admin-audit-details"><summary>JSON 상세 보기</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details></td>
      </tr>)}
    </tbody></table></div>
    <PaginationBar pagination={pagination} loading={loading} onPage={setPage} />
  </section>;
}

export function AdminSecurityControl({
  busy,
  secureRun,
}: {
  busy: boolean;
  secureRun: AdminWorkRunner;
}) {
  const [sessions, setSessions] = useState<AdminSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/sessions", { cache: "no-store" });
      const body = await response.json() as { sessions?: AdminSessionItem[]; error?: string };
      if (!response.ok || !body.sessions) throw new Error(body.error || "관리자 세션을 불러오지 못했습니다.");
      setSessions(body.sessions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "관리자 세션을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const revoke = (session: AdminSessionItem) => {
    if (!window.confirm(`${session.userAgentLabel || "알 수 없는 기기"} 세션을 종료할까요?`)) return;
    void secureRun(async () => {
      await jsonRequest("/api/admin/sessions", "DELETE", { sessionId: session.sessionId });
      await load();
    }, "선택한 관리자 세션을 종료했습니다.");
  };
  const revokeOthers = () => {
    if (!window.confirm("현재 기기를 제외한 모든 관리자 세션을 종료할까요?")) return;
    void secureRun(async () => {
      await jsonRequest("/api/admin/sessions", "DELETE", { allOthers: true });
      await load();
    }, "현재 기기를 제외한 관리자 세션을 모두 종료했습니다.");
  };

  return <section className="admin-panel admin-security-panel" aria-busy={loading}>
    <div className="admin-section-head">
      <div><span className="admin-eyebrow">SESSION SECURITY</span><h2>관리자 접속 세션</h2><p>기기·접속 위치·최근 활동을 확인하고 의심스러운 세션을 즉시 종료합니다.</p></div>
      <button className="admin-inline-danger" disabled={busy || sessions.filter((item) => !item.current).length === 0} onClick={revokeOthers}><UserRoundX size={15} /> 다른 세션 전체 종료</button>
    </div>
    {error && <div className="admin-form-error" role="alert">{error}</div>}
    <div className="admin-session-grid">
      {loading && sessions.length === 0 ? <div className="admin-empty">관리자 세션을 불러오는 중입니다.</div> : sessions.map((session) => <article key={session.sessionId} className={session.current ? "current" : ""}>
        <header><span><Laptop size={18} /><b>{session.userAgentLabel || "알 수 없는 기기"}</b></span>{session.current && <strong>현재 세션</strong>}</header>
        <dl><div><dt>접속 위치</dt><dd>{session.sourceIpMasked || "기록 없음"}</dd></div><div><dt>최근 활동</dt><dd>{dateTime(session.lastSeenAt)}</dd></div><div><dt>로그인</dt><dd>{dateTime(session.createdAt)}</dd></div><div><dt>만료</dt><dd>{dateTime(session.expiresAt)}</dd></div></dl>
        <div className="admin-session-security"><KeyRound size={14} /><span>{session.elevatedUntil > now ? `고위험 작업 인증 ${dateTime(session.elevatedUntil)}까지` : "고위험 작업 재인증 필요"}</span></div>
        {!session.current && <button className="admin-inline-danger" disabled={busy} onClick={() => revoke(session)}>이 세션 종료</button>}
      </article>)}
    </div>
  </section>;
}

export function AdminOperationsControl({
  busy,
  secureRun,
}: {
  busy: boolean;
  secureRun: AdminWorkRunner;
}) {
  const [data, setData] = useState<OperationsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [expires, setExpires] = useState<Record<string, string>>({});
  const [checkNotes, setCheckNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/operations", { cache: "no-store" });
      const body = await response.json() as OperationsPayload & { error?: string };
      if (!response.ok || !body.featureKeys) throw new Error(body.error || "운영 상태를 불러오지 못했습니다.");
      setData(body);
      setReasons((current) => ({ ...Object.fromEntries(body.controls.map((item) => [item.featureKey, item.reason])), ...current }));
      setCheckNotes((current) => ({ ...Object.fromEntries(body.checks.map((item) => [item.checkKey, item.note])), ...current }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "운영 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const controlMap = useMemo(() => new Map((data?.controls ?? []).map((item) => [item.featureKey, item])), [data?.controls]);
  const jobMap = useMemo(() => new Map((data?.jobs ?? []).map((item) => [item.jobKey, item])), [data?.jobs]);
  const checkMap = useMemo(() => new Map((data?.checks ?? []).map((item) => [item.checkKey, item])), [data?.checks]);

  const toggleFeature = (featureKey: string) => {
    const current = controlMap.get(featureKey);
    const disabling = current?.mode !== "disabled";
    const reason = reasons[featureKey]?.trim() ?? "";
    if (disabling && reason.length < 3) {
      setError("기능을 중지하려면 운영 사유를 3자 이상 입력해 주세요.");
      return;
    }
    if (disabling && !window.confirm(`${featureLabels[featureKey] ?? featureKey} 기능을 중지할까요? 사용자 쓰기 요청이 503으로 차단됩니다.`)) return;
    void secureRun(async () => {
      await jsonRequest("/api/admin/operations", "PATCH", {
        type: "control",
        featureKey,
        mode: disabling ? "disabled" : "enabled",
        reason: disabling ? reason : "",
        expiresAt: disabling ? toUnix(expires[featureKey] ?? "") : null,
      });
      await load();
    }, disabling ? `${featureLabels[featureKey] ?? featureKey} 기능을 중지했습니다.` : `${featureLabels[featureKey] ?? featureKey} 기능을 재개했습니다.`);
  };

  const retryJob = (jobKey: string) => {
    void secureRun(async () => {
      await jsonRequest("/api/admin/operations", "POST", { jobKey });
      await load();
    }, `${jobLabels[jobKey] ?? jobKey} 작업을 실행했습니다.`);
  };

  const updateCheck = (checkKey: string, status: OperationalCheck["status"]) => {
    const note = checkNotes[checkKey]?.trim() ?? "";
    if (note.length < 3) {
      setError("점검 근거를 3자 이상 입력해 주세요.");
      return;
    }
    void secureRun(async () => {
      await jsonRequest("/api/admin/operations", "PATCH", {
        type: "check",
        checkKey,
        status,
        note,
        validUntil: Math.floor(Date.now() / 1000) + 7 * 86_400,
      });
      await load();
    }, `${checkLabels[checkKey] ?? checkKey} 점검 결과를 기록했습니다.`);
  };

  return <section className="admin-panel admin-operations-panel" aria-busy={loading}>
    <div className="admin-section-head">
      <div><span className="admin-eyebrow">OPERATIONS CENTER</span><h2>비상 운영 센터</h2><p>쓰기 기능을 즉시 중지하고, 정기 작업과 외부 백업·복구 검증 상태를 한 화면에서 확인합니다.</p></div>
      <button onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> 상태 갱신</button>
    </div>
    {error && <div className="admin-form-error" role="alert">{error}</div>}
    {!data && loading ? <div className="admin-empty">운영 상태를 불러오는 중입니다.</div> : <>
      <div className="admin-operations-title"><span><ShieldAlert size={17} /><b>긴급 기능 제어</b></span><small>관리자·로그인·상태 확인·방문 집계는 전체 중지 중에도 접근 가능합니다.</small></div>
      <div className="admin-feature-grid">{(data?.featureKeys ?? []).map((featureKey) => {
        const control = controlMap.get(featureKey);
        const disabled = control?.mode === "disabled" && (!control.expiresAt || control.expiresAt > (data?.generatedAt ?? 0));
        return <article key={featureKey} className={disabled ? "disabled" : ""}>
          <header><div><b>{control?.label || featureLabels[featureKey] || featureKey}</b><small>{featureKey}</small></div><Status value={disabled ? "paused" : "active"} /></header>
          <label>운영 사유<input value={reasons[featureKey] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [featureKey]: event.target.value }))} placeholder="장애 대응, 점검 등" /></label>
          <label>자동 재개 시각<input type="datetime-local" value={expires[featureKey] ?? ""} onChange={(event) => setExpires((current) => ({ ...current, [featureKey]: event.target.value }))} /></label>
          <button className={disabled ? "admin-primary" : "admin-inline-danger"} disabled={busy} onClick={() => toggleFeature(featureKey)}>{disabled ? "기능 재개" : "기능 중지"}</button>
          {control && <small className="admin-feature-meta">{control.updatedBy} · {dateTime(control.updatedAt)}{control.expiresAt ? ` · ${dateTime(control.expiresAt)} 자동 재개` : ""}</small>}
        </article>;
      })}</div>
      <div className="admin-operations-columns">
        <section>
          <div className="admin-operations-title"><span><Activity size={17} /><b>정기 작업 상태</b></span><small>실패한 작업을 같은 추적 경로로 재실행합니다.</small></div>
          <div className="admin-job-list">{(data?.jobKeys ?? []).map((jobKey) => {
            const job = jobMap.get(jobKey);
            const failed = Boolean(job?.lastFailedAt && (!job.lastSucceededAt || job.lastFailedAt > job.lastSucceededAt));
            return <article key={jobKey}>
              <header><span>{failed ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<b>{job?.label || jobLabels[jobKey] || jobKey}</b></span><Status value={failed ? "failed" : job?.status === "stale" ? "warning" : job?.status === "running" ? "running" : job?.lastSucceededAt ? "healthy" : "unknown"} /></header>
              <dl><div><dt>최근 성공</dt><dd>{dateTime(job?.lastSucceededAt ?? null)}</dd></div><div><dt>최근 실패</dt><dd>{dateTime(job?.lastFailedAt ?? null)}</dd></div><div><dt>소요 시간</dt><dd>{job?.lastDurationMs == null ? "-" : `${job.lastDurationMs.toLocaleString()}ms`}</dd></div><div><dt>누적 실행/연속 실패</dt><dd>{job?.runCount ?? 0} / {job?.consecutiveFailures ?? 0}</dd></div></dl>
              {job?.lastError && <p>{job.lastError}</p>}
              <button disabled={busy} onClick={() => retryJob(jobKey)}><RefreshCw size={14} /> 지금 재실행</button>
            </article>;
          })}</div>
        </section>
        <section>
          <div className="admin-operations-title"><span><DatabaseBackup size={17} /><b>백업·복구 검증 기록</b></span><small>외부 백업 시스템에서 확인한 결과를 근거와 함께 기록합니다.</small></div>
          <div className="admin-check-list">{Object.keys(checkLabels).map((checkKey) => {
            const check = checkMap.get(checkKey);
            return <article key={checkKey}>
              <header><b>{checkLabels[checkKey]}</b><Status value={check?.status ?? "unknown"} /></header>
              <textarea value={checkNotes[checkKey] ?? ""} onChange={(event) => setCheckNotes((current) => ({ ...current, [checkKey]: event.target.value }))} placeholder="스냅샷 ID, 복구 환경, 확인 결과 등" />
              <div><button disabled={busy} onClick={() => updateCheck(checkKey, "healthy")}>정상 확인</button><button disabled={busy} onClick={() => updateCheck(checkKey, "warning")}>주의 기록</button><button className="admin-inline-danger" disabled={busy} onClick={() => updateCheck(checkKey, "critical")}>실패 기록</button></div>
              {check && <small>{check.checkedBy} · {dateTime(check.checkedAt)}{check.validUntil ? ` · ${dateTime(check.validUntil)}까지 유효` : ""}</small>}
            </article>;
          })}</div>
        </section>
      </div>
    </>}
  </section>;
}

function PaginationBar({
  pagination,
  loading,
  onPage,
}: {
  pagination: Pagination;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return <nav className="admin-pagination" aria-label="페이지 이동">
    <span>{pagination.total.toLocaleString()}개 중 {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.total, pagination.page * pagination.pageSize)} · {pagination.page}/{pagination.totalPages} 페이지</span>
    <div><button disabled={loading || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ChevronLeft size={14} /> 이전</button><button disabled={loading || pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>다음 <ChevronRight size={14} /></button></div>
  </nav>;
}

function Status({ value }: { value: string }) {
  return <span className={`admin-status status-${value}`}>{value}</span>;
}

async function jsonRequest(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
