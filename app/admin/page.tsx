"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Ban, BarChart3, CircleDollarSign, Clock3, Crown, EyeOff, Gavel, HardDrive, LogOut, Megaphone, MessageSquare, PauseCircle, Pencil, Plus, RefreshCw, Save, Search, Server, ShieldAlert, ShieldCheck, Trash2, Trophy } from "lucide-react";
import { useChatRealtime, type ChatConnectionStatus } from "@/lib/use-chat-realtime";
import type { ChatRealtimeEvent } from "@/lib/chat-realtime";
import { announcementPhase } from "@/lib/site-announcement-lifecycle.mjs";

type AdminServer = {
  id: string; ownerEmail: string; title: string; address: string; port: number; status: string; deletedAt: number | null;
  votesOverride: number | null; uptime: number | null; premiumManaged: boolean; premiumTier: "none" | "premium";
  baseVotes: number; votes: number; votesAdjustment: number; baseUptime: number; uptimeAdjustment: number; uptimeOverride: number | null;
  premiumStartsAt: number | null; premiumEndsAt: number | null; premiumNote: string; premiumActive: boolean;
  players: number | null; maxPlayers: number | null; lastSeenAt: number | null;
  ownerVerificationStatus: string; ownerVerifiedAt: number | null;
};
type AdminOwnershipClaim = { id: string; serverId: string; serverTitle: string; address: string; port: number; currentOwnerEmail: string; claimantEmail: string; method: "motd" | "dns"; status: string; requestedAt: number; verifiedAt: number | null; reviewedAt: number | null; reviewedBy: string | null; reviewNote: string };
type AdminOwnershipTransfer = { id: string; serverId: string; serverTitle: string; address: string; port: number; fromEmail: string; toEmail: string; status: string; requestedAt: number; acceptedAt: number | null; completedAt: number | null };
type BlacklistEntry = { id: string; kind: "ip" | "address"; value: string; reason: string; status: string; expires_at: number | null; created_at: number };
type ServerEnforcement = { id: string; server_id: string; server_title: string; owner_email: string; address: string; port: number; kind: "warning" | "suspension" | "blind"; reason: string; status: string; starts_at: number; expires_at: number | null; created_by: string; resolved_by: string | null; resolved_at: number | null; resolution_note: string; created_at: number; updated_at: number };
type Conversation = { server_id: string; title: string; owner_email: string; unread_admin: number; last_message: string | null; last_message_at: number | null };
type Audit = { id: string; admin_email: string; action: string; target_type: string; target_id: string; details: Record<string, unknown>; created_at: number };
type IdentityAccount = { id: string; email: string; email_verified_at: number; last_login_at: number; identity_verification_status: string; identity_verified_at: number | null; identity_provider: string; identity_reference: string; created_at: number; updated_at: number };
type Message = { id: string; sender_role: "admin" | "owner"; sender_email: string; body: string; created_at: number };
type AdminAnnouncement = {
  id: string; title: string; summary: string; detail: string; status: "draft" | "published" | "archived";
  startsAt: number; endsAt: number; revision: number; createdBy: string; updatedBy: string;
  createdAt: number; updatedAt: number; deletedAt: number | null; deletedBy: string | null;
};
type VoteLog = {
  id: string; serverId: string; serverTitle: string; serverAddress: string; ownerEmail: string; nickname: string;
  minecraftUuid: string | null; voteDay: string; rewardStatus: string; ipMasked: string; ipKey: string;
  ipVersion: number; ipMetadataExpiresAt: number | null;
  ipBlock: { id: string; reason: string; expiresAt: number } | null; createdAt: number;
};
type VoteLogResponse = {
  logs: VoteLog[];
  summary: { total: number; today: number; uniquePlayers: number; uniqueSources: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  privacy: { rawIpStored: false; ipMetadataRetentionDays: number };
};
type CacheCounter = { objects: number; bytes: number };
type BroadcastCacheStats = CacheCounter & {
  byKind: { preview: CacheCounter; profile: CacheCounter };
  byPlatform: { chzzk: CacheCounter; soop: CacheCounter };
};
type BroadcastCacheCleanup = {
  deleted: number; deletedBytes: number; retained: number; skippedPlatforms: Array<"chzzk" | "soop">;
};
type AdminAuctionDashboard = {
  current: { id: string; targetStartsAt: number; targetEndsAt: number; biddingOpensAt: number; blindStartsAt: number; latestClosesAt: number; blindActive: boolean; slotCount: number; minimumBid: number; minimumIncrement: number; status: string; finalizedAt: number | null };
  auctions: Array<{ id: string; targetStartsAt: number; targetEndsAt: number; slotCount: number; status: string; finalizedAt: number | null }>;
  bids: Array<{ id: string; serverId: string; serverTitle: string; ownerEmail: string; amount: number; status: string; rank: number; inWinningRange: boolean; updatedAt: number }>;
  awards: Array<{ id: string; serverId: string; serverTitle: string; ownerEmail: string; amount: number; status: string; paymentConfirmedAt: number | null; paymentReference: string | null }>;
  placements: Array<{ id: string; auctionId: string | null; awardId: string | null; serverId: string; serverTitle: string; ownerEmail: string; source: string; amount: number; status: string; startsAt: number; endsAt: number; note: string; createdBy: string; createdAt: number; updatedAt: number }>;
  currentSlots: { capacity: number; occupied: number; vacancies: number; endsAt: number; placements: AdminAuctionDashboard["placements"] };
};
type Overview = {
  admin: { email: string; expiresAt: number; authMode: "session" | "temporary-bypass" };
  stats: { totalServers: number; premiumServers: number; blacklistedServers: number; activeEnforcements: number; unreadMessages: number; pendingOwnership: number };
  servers: AdminServer[]; blacklist: BlacklistEntry[]; enforcements: ServerEnforcement[]; conversations: Conversation[]; audits: Audit[]; identities: IdentityAccount[];
  announcements: AdminAnnouncement[];
  ownership: { claims: AdminOwnershipClaim[]; transfers: AdminOwnershipTransfer[] };
};
type Tab = "announcements" | "servers" | "votes" | "enforcements" | "identity" | "ownership" | "premium" | "blacklist" | "messages" | "cache" | "audit";

const dateTime = (unix: number | null) => unix ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(unix * 1000) : "-";
const auctionDateTime = (unix: number) => `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(unix * 1000)} KST`;
const toUnix = (value: string) => value ? Math.floor(new Date(value).getTime() / 1000) : null;
const announcementDateTime = (unix: number) => `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(unix * 1000)} KST`;
const toKstInput = (unix: number) => new Date((unix + 9 * 60 * 60) * 1000).toISOString().slice(0, 16);
const fromKstInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
};
const VOTE_BLOCK_SECONDS: Record<string, number> = { "1d": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400, "90d": 90 * 86_400 };

export default function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("servers");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [latestChatEvent, setLatestChatEvent] = useState<ChatRealtimeEvent | null>(null);
  const [adminNow, setAdminNow] = useState(() => Math.floor(Date.now() / 1000));

  const loadOverview = useCallback(async () => {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); setOverview(null); return; }
    const data = await response.json() as Overview & { error?: string };
    if (!response.ok) throw new Error(data.error || "관리자 현황을 불러오지 못했습니다.");
    setOverview(data);
    setAuthenticated(true);
  }, []);

  const handleAdminRealtime = useCallback((event: ChatRealtimeEvent) => {
    setLatestChatEvent(event);
    void loadOverview();
  }, [loadOverview]);

  const adminChatConnection = useChatRealtime({
    enabled: authenticated, role: "admin", onEvent: handleAdminRealtime,
  });

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(); setAuthenticated(true); return loadOverview(); })
      .catch(() => setAuthenticated(false)).finally(() => setChecking(false));
  }, [loadOverview]);

  useEffect(() => {
    if (overview?.admin.authMode !== "temporary-bypass") return;
    const remaining = Math.max(0, overview.admin.expiresAt * 1000 - Date.now());
    const timer = window.setTimeout(() => {
      setAuthenticated(false);
      setOverview(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [overview?.admin.authMode, overview?.admin.expiresAt]);

  useEffect(() => {
    const interval = window.setInterval(() => setAdminNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const run = async (work: () => Promise<void>, message: string) => {
    setBusy(true); setNotice("");
    try { await work(); setNotice(message); }
    catch (error) { setNotice(error instanceof Error ? error.message : "요청에 실패했습니다."); }
    finally { setBusy(false); }
  };

  if (checking) return <AdminFrame><div className="admin-loading">총관리자 보안 세션 확인 중…</div></AdminFrame>;
  if (!authenticated) return <AdminLogin onSuccess={async () => { setAuthenticated(true); await loadOverview(); }} />;

  const logout = () => run(async () => {
    const response = await fetch("/api/admin/session", { method: "DELETE" });
    if (!response.ok) throw new Error("로그아웃에 실패했습니다.");
    setAuthenticated(false); setOverview(null);
  }, "로그아웃했습니다.");

  return <AdminFrame>
    <header className="admin-topbar">
      <div><span className="admin-eyebrow">MINECRAFT.KR CONTROL</span><h1>총관리자 시스템</h1></div>
      <div className="admin-top-actions"><AdminRealtimeBadge status={adminChatConnection} /><span className="admin-session"><ShieldCheck size={15} /> {overview?.admin.email}{overview?.admin.authMode === "temporary-bypass" ? ` · 임시 접근 ${dateTime(overview.admin.expiresAt)} 만료` : ""}</span><button onClick={() => run(loadOverview, "최신 데이터로 갱신했습니다.")} disabled={busy}><RefreshCw size={15} /> 새로고침</button><button onClick={logout}><LogOut size={15} /> 로그아웃</button></div>
    </header>
    {overview && <>
      <section className="admin-stats" aria-label="주요 현황">
        <Stat icon={<Server />} label="운영 서버" value={overview.stats.totalServers} />
        <Stat icon={<Crown />} label="프리미엄" value={overview.stats.premiumServers} />
        <Stat icon={<Ban />} label="차단 서버" value={overview.stats.blacklistedServers} />
        <Stat icon={<ShieldAlert />} label="활성 제재" value={overview.stats.activeEnforcements} />
        <Stat icon={<MessageSquare />} label="미확인 대화" value={overview.stats.unreadMessages} />
        <Stat icon={<ArrowRightLeft />} label="소유권 심사" value={overview.stats.pendingOwnership} />
      </section>
      <nav className="admin-tabs" role="tablist" aria-label="총관리자 메뉴">
        {([[
          "announcements", "공지사항", Megaphone
        ], ["servers", "서버 제어", Server
        ], ["votes", "추천 기록", Trophy], ["enforcements", "서버 제재", ShieldAlert], ["identity", "본인인증", ShieldCheck], ["ownership", "소유권 심사", ArrowRightLeft], ["premium", "프리미엄", Crown], ["blacklist", "블랙리스트", Ban], ["messages", "직통라인", MessageSquare], ["cache", "캐시 정리", HardDrive], ["audit", "감사 로그", BarChart3]] as const).map(([key, label, Icon]) =>
          <button key={key} type="button" id={`admin-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`admin-tabpanel-${key}`} tabIndex={tab === key ? 0 : -1} className={tab === key ? "active" : ""} onClick={() => setTab(key)} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
            const index = tabs.indexOf(event.currentTarget);
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            tabs[nextIndex]?.focus();
            tabs[nextIndex]?.click();
          }}><Icon size={16} />{label}{key === "announcements" && overview.announcements.filter((item) => announcementPhase(item, adminNow) === "active").length > 0 && <b>{overview.announcements.filter((item) => announcementPhase(item, adminNow) === "active").length}</b>}{key === "enforcements" && overview.stats.activeEnforcements > 0 && <b>{overview.stats.activeEnforcements}</b>}{key === "messages" && overview.stats.unreadMessages > 0 && <b>{overview.stats.unreadMessages}</b>}{key === "ownership" && overview.stats.pendingOwnership > 0 && <b>{overview.stats.pendingOwnership}</b>}{key === "identity" && overview.identities.filter((item) => item.identity_verification_status !== "verified").length > 0 && <b>{overview.identities.filter((item) => item.identity_verification_status !== "verified").length}</b>}</button>)}
      </nav>
      {notice && <div className="admin-notice" role="status">{notice}</div>}
      <section id={`admin-tabpanel-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`} tabIndex={0}>
        {tab === "announcements" && <AnnouncementControl entries={overview.announcements} busy={busy} run={run} refresh={loadOverview} now={adminNow} />}
        {tab === "servers" && <ServerControl servers={overview.servers} busy={busy} run={run} refresh={loadOverview} />}
        {tab === "votes" && <VoteLogControl servers={overview.servers} />}
        {tab === "enforcements" && <EnforcementControl entries={overview.enforcements} servers={overview.servers.filter((item) => !item.deletedAt)} busy={busy} run={run} refresh={loadOverview} />}
        {tab === "identity" && <IdentityControl accounts={overview.identities} busy={busy} run={run} refresh={loadOverview} />}
        {tab === "ownership" && <OwnershipControl claims={overview.ownership.claims} transfers={overview.ownership.transfers} busy={busy} run={run} refresh={loadOverview} />}
        {tab === "premium" && <PremiumAuctionControl busy={busy} run={run} servers={overview.servers.filter((item) => !item.deletedAt)} />}
        {tab === "blacklist" && <BlacklistControl entries={overview.blacklist} busy={busy} run={run} refresh={loadOverview} />}
        {tab === "messages" && <MessageControl conversations={overview.conversations} servers={overview.servers.filter((item) => !item.deletedAt)} busy={busy} run={run} refresh={loadOverview} realtimeEvent={latestChatEvent} connectionStatus={adminChatConnection} />}
        {tab === "cache" && <CacheControl busy={busy} run={run} />}
        {tab === "audit" && <AuditLog entries={overview.audits} />}
      </section>
    </>}
  </AdminFrame>;
}

function AdminFrame({ children }: { children: React.ReactNode }) {
  return <main className="admin-shell"><div className="admin-wrap">{children}</div></main>;
}

function AdminLogin({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [email, setEmail] = useState("admin@minecraft.kr");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, otp }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "로그인에 실패했습니다.");
      await onSuccess();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "로그인에 실패했습니다."); }
    finally { setBusy(false); }
  };
  return <AdminFrame><section className="admin-login-card">
    <div className="admin-login-mark"><ShieldCheck /></div><span className="admin-eyebrow">RESTRICTED ACCESS</span><h1>총관리자 인증</h1><p>비밀번호와 OTP 앱의 6자리 코드를 함께 입력하세요.</p>
    <form onSubmit={submit} className="admin-login-form">
      <label>관리자 이메일<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
      <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <label>OTP 6자리<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" required /></label>
      {error && <div className="admin-form-error" role="alert">{error}</div>}<button className="admin-primary" disabled={busy}>{busy ? "인증 중…" : "보안 로그인"}</button>
    </form><small>5회 실패 시 15분간 로그인이 잠깁니다.</small>
  </section></AdminFrame>;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <article><span>{icon}</span><div><b>{value.toLocaleString()}</b><small>{label}</small></div></article>;
}

function ServerControl({ servers, busy, run, refresh }: ControlProps) {
  const live = servers.filter((item) => !item.deletedAt);
  const [selectedId, setSelectedId] = useState(live[0]?.id ?? "");
  const selected = live.find((item) => item.id === selectedId) ?? live[0];
  const [votesDelta, setVotesDelta] = useState("0"); const [uptimeDelta, setUptimeDelta] = useState("0"); const [confirmation, setConfirmation] = useState(""); const [reason, setReason] = useState("");
  const selectServer = (id: string) => { setSelectedId(id); setVotesDelta("0"); setUptimeDelta("0"); setConfirmation(""); setReason(""); };
  if (!selected) return <Empty text="등록된 서버가 없습니다." />;
  const adjustMetrics = (nextVotesDelta = Number(votesDelta || 0), nextUptimeDelta = Number(uptimeDelta || 0)) => run(async () => {
    await jsonRequest(`/api/admin/servers/${selected.id}`, "PATCH", { action: "adjust_metrics", votesDelta: nextVotesDelta, uptimeDelta: nextUptimeDelta });
    setVotesDelta("0"); setUptimeDelta("0");
    await refresh();
  }, `추천수 ${signedValue(nextVotesDelta)} · 업타임 ${signedValue(nextUptimeDelta, "%")}를 반영했습니다.`);
  const resetMetrics = () => run(async () => {
    await jsonRequest(`/api/admin/servers/${selected.id}`, "PATCH", { action: "reset_metric_adjustments" });
    setVotesDelta("0"); setUptimeDelta("0"); await refresh();
  }, "추천수와 업타임을 자동 집계값으로 복원했습니다.");
  const remove = () => run(async () => {
    const response = await fetch(`/api/admin/servers/${selected.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation, reason }) });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "삭제에 실패했습니다.");
    setSelectedId(live.find((item) => item.id !== selected.id)?.id ?? ""); await refresh();
  }, "서버를 삭제했습니다.");
  return <ControlLayout list={<ServerList servers={live} selectedId={selected.id} onSelect={selectServer} />}>
    <ControlHeading server={selected} />
    <section className="admin-metric-adjustments">
      <article><header><div><span>VOTE ADJUSTMENT</span><b>추천수 증감</b></div><strong>{selected.votes.toLocaleString()}회</strong></header><dl><div><dt>실제 추천</dt><dd>{selected.baseVotes.toLocaleString()}</dd></div><div><dt>관리자 조정</dt><dd>{signedValue(selected.votesAdjustment)}</dd></div></dl><div className="admin-metric-shortcuts"><button disabled={busy} onClick={() => void adjustMetrics(-100, 0)}>-100</button><button disabled={busy} onClick={() => void adjustMetrics(-10, 0)}>-10</button><button disabled={busy} onClick={() => void adjustMetrics(10, 0)}>+10</button><button disabled={busy} onClick={() => void adjustMetrics(100, 0)}>+100</button></div><label>직접 증감값<input type="number" step="1" value={votesDelta} onChange={(event) => setVotesDelta(event.target.value)} /></label></article>
      <article><header><div><span>UPTIME ADJUSTMENT</span><b>업타임 증감</b></div><strong>{Number(selected.uptime ?? 0).toFixed(2)}%</strong></header><dl><div><dt>30일 실측</dt><dd>{selected.baseUptime.toFixed(2)}%</dd></div><div><dt>관리자 조정</dt><dd>{signedValue(selected.uptimeAdjustment, "%")}</dd></div></dl><div className="admin-metric-shortcuts"><button disabled={busy} onClick={() => void adjustMetrics(0, -5)}>-5%</button><button disabled={busy} onClick={() => void adjustMetrics(0, -1)}>-1%</button><button disabled={busy} onClick={() => void adjustMetrics(0, 1)}>+1%</button><button disabled={busy} onClick={() => void adjustMetrics(0, 5)}>+5%</button></div><label>직접 증감값 (%)<input type="number" step="0.01" value={uptimeDelta} onChange={(event) => setUptimeDelta(event.target.value)} /></label></article>
    </section>
    <div className="admin-metric-actions"><button className="admin-primary" onClick={() => void adjustMetrics()} disabled={busy || (!Number(votesDelta) && !Number(uptimeDelta))}>입력한 증감 적용</button><button onClick={() => void resetMetrics()} disabled={busy || (!selected.votesAdjustment && !selected.uptimeAdjustment && selected.votesOverride == null && selected.uptimeOverride == null)}>자동 집계로 초기화</button></div>
    <section className="admin-danger"><h3><Trash2 size={17} /> 서버 영구 삭제</h3><p>이미지와 브리지 연결 데이터도 함께 제거되며 감사 로그는 보존됩니다.</p><div className="admin-form-grid"><label>삭제 사유<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="운영 정책 위반 등" /></label><label>서버 이름 확인<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={selected.title} /></label></div><button className="admin-danger-button" onClick={remove} disabled={busy || confirmation !== selected.title}>삭제 실행</button></section>
  </ControlLayout>;
}

function OwnershipControl({ claims, transfers, busy, run, refresh }: {
  claims: AdminOwnershipClaim[]; transfers: AdminOwnershipTransfer[];
} & Pick<ControlProps, "busy" | "run" | "refresh">) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = claims.filter((item) => item.status === "pending_review");
  const review = (claim: AdminOwnershipClaim, action: "approve" | "reject") => run(async () => {
    const response = await fetch(`/api/admin/ownership/claims/${claim.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[claim.id] ?? "" }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "소유권 심사 처리에 실패했습니다.");
    await refresh();
  }, action === "approve" ? `${claim.serverTitle} 서버 소유권을 승인하고 기존 자격 증명을 폐기했습니다.` : `${claim.serverTitle} 서버 주장을 거절했습니다.`);
  return <section className="admin-panel admin-ownership-panel">
    <div className="admin-section-head"><div><span className="admin-eyebrow">OWNERSHIP REVIEW</span><h2>서버 소유권 이전·분쟁 심사</h2><p>기술 인증 결과와 양측 이메일을 확인한 뒤 처리합니다.</p></div><b>{pending.length}건 승인 대기</b></div>
    <div className="admin-ownership-rules"><span><ShieldCheck size={17} /><b>MOTD·DNS 기술 인증 완료</b></span><span><ArrowRightLeft size={17} /><b>기존 브리지·대화 접속권 자동 폐기</b></span><span><CircleDollarSign size={17} /><b>경매·결제·광고 진행 시 자동 차단</b></span></div>
    <div className="admin-claim-list">{pending.length === 0 ? <Empty text="총관리자 승인을 기다리는 서버 주장이 없습니다." /> : pending.map((claim) => <article key={claim.id}>
      <header><div><b>{claim.serverTitle}</b><code>{claim.address}:{claim.port}</code></div><Status value="pending_review" /></header>
      <div className="admin-claim-parties"><span>현재 소유자<b>{claim.currentOwnerEmail}</b></span><ArrowRightLeft size={18} /><span>주장 계정<b>{claim.claimantEmail}</b></span></div>
      <dl><div><dt>인증 방식</dt><dd>{claim.method === "motd" ? "실서버 MOTD" : "도메인 DNS TXT"}</dd></div><div><dt>요청 시각</dt><dd>{dateTime(claim.requestedAt)}</dd></div><div><dt>기술 인증</dt><dd>{dateTime(claim.verifiedAt)}</dd></div></dl>
      <label>심사 메모<input value={notes[claim.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [claim.id]: event.target.value }))} maxLength={500} placeholder="승인 근거 또는 거절 사유" /></label>
      <div className="admin-claim-actions"><button disabled={busy} onClick={() => { if (window.confirm(`${claim.serverTitle} 서버를 ${claim.claimantEmail} 계정으로 이전할까요? 기존 브리지 키는 즉시 폐기됩니다.`)) void review(claim, "approve"); }}>주장 승인·소유권 이전</button><button disabled={busy} onClick={() => void review(claim, "reject")}>주장 거절</button></div>
    </article>)}</div>
    <div className="admin-table-wrap"><table><thead><tr><th>서버</th><th>기존 운영자</th><th>신규 운영자</th><th>상태</th><th>요청 시각</th></tr></thead><tbody>{transfers.length === 0 ? <tr><td colSpan={5}>이메일 양도 이력이 없습니다.</td></tr> : transfers.map((transfer) => <tr key={transfer.id}><td><b>{transfer.serverTitle}</b><small>{transfer.address}:{transfer.port}</small></td><td>{transfer.fromEmail}</td><td>{transfer.toEmail}</td><td><Status value={transfer.status} /></td><td>{dateTime(transfer.requestedAt)}</td></tr>)}</tbody></table></div>
  </section>;
}

function IdentityControl({ accounts, busy, run, refresh }: { accounts: IdentityAccount[] } & Pick<ControlProps, "busy" | "run" | "refresh">) {
  const verify = (account: IdentityAccount) => {
    const provider = window.prompt("본인인증 제공자명(PASS, NICE 등)을 입력하세요.", account.identity_provider || "PASS");
    if (!provider?.trim()) return;
    const reference = window.prompt("인증 결과 확인번호를 입력하세요.", account.identity_reference);
    if (!reference?.trim()) return;
    void run(async () => {
      await jsonRequest(`/api/admin/identity/${account.id}`, "PATCH", { action: "verify", provider: provider.trim(), reference: reference.trim() });
      await refresh();
    }, `${account.email} 계정의 본인인증을 승인했습니다.`);
  };
  const revoke = (account: IdentityAccount) => {
    if (!window.confirm(`${account.email} 본인인증을 철회할까요? 진행 중 입찰과 프리미엄 노출도 중단됩니다.`)) return;
    void run(async () => {
      await jsonRequest(`/api/admin/identity/${account.id}`, "PATCH", { action: "revoke" });
      await refresh();
    }, `${account.email} 계정의 본인인증을 철회했습니다.`);
  };
  return <section className="admin-panel"><div className="admin-section-head"><div><span className="admin-eyebrow">IDENTITY GATE</span><h2>운영자 본인인증 관리</h2><p>외부 본인인증 결과의 확인번호를 기록한 계정만 프리미엄 경매에 참여할 수 있습니다.</p></div><span>{accounts.filter((item) => item.identity_verification_status === "verified").length}개 인증</span></div><div className="admin-table-wrap"><table><thead><tr><th>이메일 계정</th><th>이메일 로그인</th><th>본인인증</th><th>제공자 / 확인번호</th><th>최근 로그인</th><th></th></tr></thead><tbody>{accounts.length === 0 ? <tr><td colSpan={6}>가입된 운영자 계정이 없습니다.</td></tr> : accounts.map((account) => <tr key={account.id}><td><b>{account.email}</b><small>{account.id}</small></td><td>{dateTime(account.email_verified_at)}</td><td><Status value={account.identity_verification_status} /></td><td>{account.identity_provider || "-"}<small>{account.identity_reference || "확인번호 없음"}</small></td><td>{dateTime(account.last_login_at)}</td><td>{account.identity_verification_status === "verified" ? <button className="admin-inline-danger" disabled={busy} onClick={() => revoke(account)}>철회</button> : <button disabled={busy} onClick={() => verify(account)}>인증 승인</button>}</td></tr>)}</tbody></table></div></section>;
}

function PremiumAuctionControl({ busy, run, servers }: { busy: boolean; run: (work: () => Promise<void>, message: string) => Promise<void>; servers: AdminServer[] }) {
  const [data, setData] = useState<AdminAuctionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotCount, setSlotCount] = useState(4);
  const [minimumBid, setMinimumBid] = useState(10000);
  const [minimumIncrement, setMinimumIncrement] = useState(1000);
  const eligibleServers = servers.filter((server) => server.status === "active" && server.ownerVerificationStatus === "verified");
  const [fillServerId, setFillServerId] = useState(eligibleServers[0]?.id ?? "");
  const [fillNote, setFillNote] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const loadInFlight = useRef(false);
  const load = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      const response = await fetch("/api/admin/auctions", { cache: "no-store" });
      const body = await response.json() as AdminAuctionDashboard & { error?: string };
      if (!response.ok) throw new Error(body.error || "경매 현황을 불러오지 못했습니다.");
      setData(body); setSlotCount(body.current.slotCount); setMinimumBid(body.current.minimumBid); setMinimumIncrement(body.current.minimumIncrement);
    } finally {
      loadInFlight.current = false;
    }
  }, []);
  const blindStartsAt = (data?.current.blindStartsAt ?? 0) * 1_000;
  const blindActive = Boolean(data && data.current.status === "open" && (data.current.blindActive || clock >= blindStartsAt));
  const refreshInterval = blindActive ? 1_000 : 10_000;
  useEffect(() => { const timer = window.setTimeout(() => { void load().finally(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, refreshInterval);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [load, refreshInterval]);
  const action = (payload: Record<string, unknown>, message: string) => run(async () => {
    if (!data) return;
    const next = await jsonRequest(`/api/admin/auctions/${data.current.id}`, "PATCH", payload) as AdminAuctionDashboard;
    setData(next); setSlotCount(next.current.slotCount); setMinimumBid(next.current.minimumBid); setMinimumIncrement(next.current.minimumIncrement);
  }, message);
  if (loading) return <div className="admin-loading">주간 프리미엄 경매를 준비하는 중…</div>;
  if (!data) return <Empty text="경매 정보를 불러오지 못했습니다." />;
  const auction = data.current;
  const configurable = data.bids.length === 0 && ["scheduled", "open"].includes(auction.status);
  const confirmPayment = (award: AdminAuctionDashboard["awards"][number]) => {
    const reference = window.prompt("입금자명, 거래번호 또는 내부 결제 확인번호를 입력하세요.", award.paymentReference ?? "");
    if (!reference?.trim()) return;
    action({ action: "confirm_payment", awardId: award.id, paymentReference: reference.trim() }, `${award.serverTitle} 결제를 확인하고 광고를 예약했습니다.`);
  };
  const fillVacancy = () => {
    const server = eligibleServers.find((item) => item.id === fillServerId);
    if (!server) return;
    action({ action: "fill_current_slot", serverId: server.id, note: fillNote }, `${server.title} 서버를 현재 빈 광고 슬롯에 배치했습니다.`);
    setFillNote("");
  };
  return <section className="admin-panel admin-auction-panel">
    <div className="admin-section-head"><div><span className="admin-eyebrow">WEEKLY PREMIUM AUCTION</span><h2>다음 주 최상단 광고 경매</h2></div><Status value={auction.status} /></div>
    <div className="admin-auction-summary"><div><span>광고 주간</span><b>{auctionDateTime(auction.targetStartsAt)} — {auctionDateTime(auction.targetEndsAt)}</b></div><div><span>블라인드 종료</span><b>{auctionDateTime(auction.blindStartsAt)}부터 5분 이내</b></div><div><span>현재 참여</span><b>{data.bids.length}개 서버</b></div><div><span>결제 대기</span><b>{data.awards.filter((item) => item.status === "payment_pending").length}건</b></div></div>
    <div className="admin-auction-history"><span>최근 경매</span>{data.auctions.slice(0, 6).map((item) => <div key={item.id} className={item.id === auction.id ? "current" : ""}><b>{auctionDateTime(item.targetStartsAt).split(" ").slice(0, 3).join(" ")}</b><Status value={item.status} /><small>{item.slotCount}개 슬롯</small></div>)}</div>
    <PremiumSlotBoard
      slots={data.currentSlots}
      eligibleServers={eligibleServers}
      selectedServerId={fillServerId}
      note={fillNote}
      busy={busy}
      onSelectServer={setFillServerId}
      onNoteChange={setFillNote}
      onFill={fillVacancy}
      onCancel={(placement) => action({ action: "cancel_manual_placement", placementId: placement.id }, `${placement.serverTitle} 수동 광고 배치를 해제했습니다.`)}
    />
    <section className="admin-auction-rules"><div><Gavel size={18} /><span><b>경매 규칙</b><small>입찰 후 규칙은 잠기며, 공개 카운트 종료 뒤 최대 5분 안에 숨겨진 난수 시각으로 마감됩니다.</small></span></div><label>광고 슬롯<input type="number" min="1" max="20" value={slotCount} disabled={!configurable} onChange={(event) => setSlotCount(Number(event.target.value))} /></label><label>최소 입찰가<input type="number" min="1000" step="1000" value={minimumBid} disabled={!configurable} onChange={(event) => setMinimumBid(Number(event.target.value))} /></label><label>최소 인상액<input type="number" min="1000" step="1000" value={minimumIncrement} disabled={!configurable} onChange={(event) => setMinimumIncrement(Number(event.target.value))} /></label><button className="admin-primary" disabled={busy || !configurable} onClick={() => action({ action: "update_rules", slotCount, minimumBid, minimumIncrement }, "경매 규칙을 저장했습니다.")}>규칙 저장</button></section>
    <div className="admin-auction-columns"><section><div className="admin-auction-title"><div><b>실시간 입찰 순위</b><span>{blindActive ? "블라인드 구간 · 1초 갱신" : "10초 갱신"} · 금액 내림차순 · 동일 금액은 먼저 도달한 서버 우선</span></div><strong>{data.bids.length} BIDS</strong></div><div className="admin-table-wrap"><table><thead><tr><th>순위</th><th>서버</th><th>운영자</th><th>입찰가</th><th>상태</th></tr></thead><tbody>{data.bids.length === 0 ? <tr><td colSpan={5}>아직 입찰이 없습니다.</td></tr> : data.bids.map((bid) => <tr key={bid.id} className={bid.inWinningRange ? "auction-winning-row" : ""}><td>{bid.rank}</td><td><b>{bid.serverTitle}</b><small>{bid.serverId}</small></td><td>{bid.ownerEmail}</td><td><code>{adminWon(bid.amount)}</code></td><td><Status value={bid.inWinningRange && bid.status === "active" ? "winning" : bid.status} /></td></tr>)}</tbody></table></div></section><section><div className="admin-auction-title"><div><b>낙찰·결제 확인</b><span>결제 확인번호 기록 후 다음 주 프리미엄 노출이 예약됩니다.</span></div><CircleDollarSign size={18} /></div><div className="admin-award-list">{data.awards.length === 0 ? <Empty text="경매 마감 후 낙찰 내역이 표시됩니다." /> : data.awards.map((award) => <article key={award.id}><div><b>{award.serverTitle}</b><span>{award.ownerEmail}</span><strong>{adminWon(award.amount)}</strong>{award.paymentReference && <small>결제 확인 · {award.paymentReference}</small>}</div><Status value={award.status} />{award.status === "payment_pending" && <div className="admin-award-actions"><button disabled={busy} onClick={() => confirmPayment(award)}>결제 확인</button><button disabled={busy} onClick={() => action({ action: "forfeit", awardId: award.id }, "미결제 낙찰을 포기 처리하고 차순위를 승계했습니다.")}>미결제 포기</button></div>}</article>)}</div></section></div>
    <div className="admin-auction-danger"><div><b>경매 운영 제어</b><span>조기 마감은 현재 순위로 즉시 낙찰하며 되돌릴 수 없습니다.</span></div><button disabled={busy || !["scheduled", "open"].includes(auction.status)} onClick={() => { if (window.confirm("현재 순위로 경매를 조기 마감할까요?")) void action({ action: "finalize_now", confirmation: auction.id }, "경매를 조기 마감하고 낙찰자를 확정했습니다."); }}>현재 순위로 조기 마감</button><button className="admin-inline-danger" disabled={busy || !["scheduled", "open"].includes(auction.status)} onClick={() => { if (window.confirm("이번 주 프리미엄 경매를 취소할까요?")) void action({ action: "cancel", confirmation: auction.id }, "경매를 취소했습니다."); }}>경매 취소</button></div>
    <section className="admin-premium-history"><div className="admin-auction-title"><div><b>프리미엄 광고 과거 내역</b><span>경매 낙찰과 총관리자 수동 배치를 당시 서버명·기간·처리자로 영구 보존합니다.</span></div><strong>{data.placements.length} RECORDS</strong></div><div className="admin-table-wrap"><table><thead><tr><th>서버</th><th>배치 방식</th><th>광고 기간</th><th>금액</th><th>상태</th><th>처리자 / 메모</th></tr></thead><tbody>{data.placements.length === 0 ? <tr><td colSpan={6}>저장된 프리미엄 광고 이력이 없습니다.</td></tr> : data.placements.map((placement) => <tr key={placement.id}><td><b>{placement.serverTitle}</b><small>{placement.ownerEmail}</small></td><td>{premiumSource(placement.source)}<small>{placement.auctionId ? `경매 ${placement.auctionId.slice(0, 8)}` : "수동 배치"}</small></td><td>{auctionDateTime(placement.startsAt)}<small>— {auctionDateTime(placement.endsAt)}</small></td><td>{placement.amount ? adminWon(placement.amount) : "무상"}</td><td><Status value={placement.status} /></td><td>{placement.createdBy}<small>{placement.note || "메모 없음"}</small></td></tr>)}</tbody></table></div></section>
  </section>;
}

type PremiumPlacement = AdminAuctionDashboard["placements"][number];

function PremiumSlotBoard({ slots, eligibleServers, selectedServerId, note, busy, onSelectServer, onNoteChange, onFill, onCancel }: {
  slots: AdminAuctionDashboard["currentSlots"];
  eligibleServers: AdminServer[];
  selectedServerId: string;
  note: string;
  busy: boolean;
  onSelectServer: (value: string) => void;
  onNoteChange: (value: string) => void;
  onFill: () => void;
  onCancel: (placement: PremiumPlacement) => void;
}) {
  const capacity = Math.max(1, slots.capacity);
  const occupancy = Math.min(capacity, slots.placements.length);
  const vacancies = Math.max(0, capacity - occupancy);
  const fillPercent = Math.round((occupancy / capacity) * 100);
  const visualSlots = Array.from({ length: capacity }, (_, index) => slots.placements[index] ?? null);
  const overflow = Math.max(0, slots.placements.length - capacity);

  return <section className="admin-slot-fill">
    <header>
      <div className="admin-slot-head-copy">
        <span className="admin-eyebrow">CURRENT PREMIUM SLOTS</span>
        <h3>이번 주 프리미엄 광고 슬롯</h3>
        <p><Clock3 size={12} /> {auctionDateTime(slots.endsAt)} 종료 · 다음 주 경매 낙찰 서버로 자동 교체</p>
      </div>
      <div className="admin-slot-meter" aria-label={`전체 ${capacity}개 중 ${occupancy}개 사용 중`}>
        <div className="admin-slot-meter-values"><span><b>{occupancy}</b>사용 중</span><span><b>{vacancies}</b>빈자리</span><span><b>{capacity}</b>전체</span></div>
        <div className="admin-slot-progress"><i style={{ width: `${fillPercent}%` }} /></div>
      </div>
    </header>
    <div className="admin-slot-legend" aria-label="광고 슬롯 구분">
      <span><i className="auction" />경매 낙찰</span>
      <span><i className="manual" />총관리자 수동 배치</span>
      <span><i className="empty" />비어 있는 슬롯</span>
    </div>
    {overflow > 0 && <div className="admin-slot-warning">정원 초과 광고 {overflow}건이 감지되었습니다. 현재 주간 슬롯에는 정원까지만 노출됩니다.</div>}
    <div className="admin-slot-board">
      {visualSlots.map((placement, index) => placement ? <article key={placement.id} className={`admin-slot-card is-filled source-${placement.source}`}>
        <div className="admin-slot-card-top"><span className="admin-slot-index">SLOT {String(index + 1).padStart(2, "0")}</span><span className="admin-slot-live"><i />노출 중</span></div>
        <div className="admin-slot-server">
          <span className="admin-slot-server-icon" style={{ backgroundImage: `url(/api/servers/${placement.serverId}/assets/icon)` }} />
          <div><b>{placement.serverTitle}</b><span>{placement.ownerEmail}</span></div>
        </div>
        <div className="admin-slot-card-meta"><span className="admin-slot-source">{placement.source === "auction" ? <Crown size={13} /> : <ShieldCheck size={13} />}{premiumSource(placement.source)}</span><small>{auctionDateTime(placement.endsAt)}까지</small></div>
        {placement.note && <p title={placement.note}>{placement.note}</p>}
        {["manual_fill", "legacy_manual"].includes(placement.source) && <button className="admin-slot-cancel" disabled={busy} onClick={() => onCancel(placement)}>수동 배치 해제</button>}
      </article> : <article key={`empty-${index}`} className="admin-slot-card is-empty">
        <span className="admin-slot-index">SLOT {String(index + 1).padStart(2, "0")}</span>
        <div><Plus size={22} /><b>빈 광고 자리</b><span>아래에서 인증 서버를 선택해 즉시 채울 수 있습니다.</span></div>
      </article>)}
    </div>
    <div className="admin-slot-form-head"><div><span className="admin-eyebrow">QUICK FILL</span><b>빈자리 즉시 배치</b></div><p>수동 광고는 이번 주 종료 시 자동 해제되며 다음 경매 광고를 방해하지 않습니다.</p></div>
    <div className="admin-slot-form">
      <label><span><b>1</b> 인증 서버 선택</span><select value={selectedServerId} onChange={(event) => onSelectServer(event.target.value)}><option value="">서버 선택</option>{eligibleServers.map((server) => <option key={server.id} value={server.id}>{server.title} · {server.ownerEmail}</option>)}</select></label>
      <label><span><b>2</b> 배치 메모</span><input value={note} maxLength={200} onChange={(event) => onNoteChange(event.target.value)} placeholder="프로모션, 보상 배치 등 (선택)" /></label>
      <button className="admin-primary" disabled={busy || vacancies < 1 || !selectedServerId} onClick={onFill}><span>3</span><Plus size={15} />{vacancies < 1 ? "현재 빈자리 없음" : "선택 서버 배치"}</button>
    </div>
  </section>;
}

function adminWon(value: number) { return `${new Intl.NumberFormat("ko-KR").format(value)}원`; }
function premiumSource(value: string) { return value === "auction" ? "주간 경매" : value === "manual_fill" ? "빈 슬롯 수동 배치" : value === "legacy_manual" ? "기존 수동 광고" : value; }
function signedValue(value: number, suffix = "") { return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)}${suffix}`; }

function EnforcementControl({ entries, servers, busy, run, refresh }: { entries: ServerEnforcement[] } & ControlProps) {
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [kind, setKind] = useState<ServerEnforcement["kind"]>("warning");
  const [duration, setDuration] = useState("7d");
  const [customExpiry, setCustomExpiry] = useState("");
  const [reason, setReason] = useState("");
  const active = entries.filter((entry) => entry.status === "active");
  const activeCounts = {
    warning: active.filter((entry) => entry.kind === "warning").length,
    suspension: active.filter((entry) => entry.kind === "suspension").length,
    blind: active.filter((entry) => entry.kind === "blind").length,
  };
  const create = () => run(async () => {
    const expiresAt = duration === "manual" ? null : duration === "custom" ? toUnix(customExpiry) : Math.floor(Date.now() / 1000) + Number(duration.replace("d", "")) * 86_400;
    await jsonRequest("/api/admin/enforcements", "POST", { serverId, kind, reason, expiresAt });
    setReason(""); setCustomExpiry(""); await refresh();
  }, `${enforcementKindLabel(kind)} 조치를 적용했습니다.`);
  const revoke = (entry: ServerEnforcement) => {
    if (!window.confirm(`${entry.server_title} 서버의 ${enforcementKindLabel(entry.kind)} 조치를 해제할까요?`)) return;
    void run(async () => {
      const response = await fetch(`/api/admin/enforcements/${entry.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "총관리자 화면에서 수동 해제" }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "제재 해제에 실패했습니다.");
      await refresh();
    }, `${entry.server_title} 서버의 ${enforcementKindLabel(entry.kind)} 조치를 해제했습니다.`);
  };

  return <section className="admin-panel admin-enforcement-panel">
    <div className="admin-section-head"><div><span className="admin-eyebrow">SERVER ENFORCEMENT</span><h2>서버 경고·차단·블라인드</h2><p>제재 사유와 기간을 기록하고, 만료된 조치는 자동으로 공개 상태를 복구합니다.</p></div><span>{active.length}건 적용 중</span></div>
    <div className="admin-enforcement-summary">
      <article className="warning"><ShieldAlert /><span>경고<b>{activeCounts.warning}</b><small>공개 유지 · 운영자 고지</small></span></article>
      <article className="suspension"><PauseCircle /><span>임시 차단<b>{activeCounts.suspension}</b><small>목록·상세·경매 중단</small></span></article>
      <article className="blind"><EyeOff /><span>블라인드<b>{activeCounts.blind}</b><small>목록과 상세에서 숨김</small></span></article>
    </div>
    <div className="admin-enforcement-form">
      <label><span>1 · 대상 서버</span><select value={serverId} onChange={(event) => setServerId(event.target.value)}><option value="">서버 선택</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.title} · {server.address}</option>)}</select></label>
      <label><span>2 · 조치 종류</span><select value={kind} onChange={(event) => setKind(event.target.value as ServerEnforcement["kind"])}><option value="warning">경고 · 공개 유지</option><option value="suspension">임시 차단 · 공개 중단</option><option value="blind">블라인드 · 검색/상세 숨김</option></select></label>
      <label><span>3 · 적용 기간</span><select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="1d">24시간</option><option value="3d">3일</option><option value="7d">7일</option><option value="30d">30일</option><option value="custom">날짜 직접 지정</option><option value="manual">수동 해제까지</option></select></label>
      {duration === "custom" && <label><span>종료 날짜·시간</span><input type="datetime-local" value={customExpiry} onChange={(event) => setCustomExpiry(event.target.value)} /></label>}
      <label className="reason"><span>4 · 제재 사유</span><textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="운영 정책 위반 내용과 확인 근거를 구체적으로 입력하세요." /></label>
      <button className={`admin-enforcement-submit ${kind}`} disabled={busy || !serverId || reason.trim().length < 3 || (duration === "custom" && !toUnix(customExpiry))} onClick={() => void create()}>{kind === "warning" ? <ShieldAlert size={16} /> : kind === "suspension" ? <PauseCircle size={16} /> : <EyeOff size={16} />}{enforcementKindLabel(kind)} 적용</button>
    </div>
    <div className="admin-enforcement-section-title"><div><b>현재 적용 중인 서버</b><span>경고 및 노출 제한 상태를 한눈에 확인합니다.</span></div><strong>{active.length} ACTIVE</strong></div>
    <div className="admin-enforcement-active-grid">{active.length === 0 ? <Empty text="현재 적용 중인 서버 제재가 없습니다." /> : active.map((entry) => <article key={entry.id} className={entry.kind}>
      <header><span>{entry.kind === "warning" ? <ShieldAlert size={17} /> : entry.kind === "suspension" ? <PauseCircle size={17} /> : <EyeOff size={17} />}{enforcementKindLabel(entry.kind)}</span><Status value="active" /></header>
      <div className="admin-enforcement-server"><span className="admin-enforcement-icon" style={{ backgroundImage: `url(/api/servers/${entry.server_id}/assets/icon)` }} /><div><b>{entry.server_title}</b><code>{entry.address}:{entry.port}</code><small>{entry.owner_email}</small></div></div>
      <p>{entry.reason}</p>
      <dl><div><dt>적용</dt><dd>{dateTime(entry.starts_at)}</dd></div><div><dt>종료</dt><dd>{entry.expires_at ? dateTime(entry.expires_at) : "수동 해제"}</dd></div></dl>
      <button disabled={busy} onClick={() => revoke(entry)}>{enforcementKindLabel(entry.kind)} 해제</button>
    </article>)}</div>
    <div className="admin-enforcement-section-title history"><div><b>전체 제재 이력</b><span>만료·해제된 기록과 처리자를 보존합니다.</span></div><strong>{entries.length} RECORDS</strong></div>
    <div className="admin-table-wrap"><table><thead><tr><th>서버</th><th>조치</th><th>사유</th><th>기간</th><th>상태</th><th>처리자</th></tr></thead><tbody>{entries.length === 0 ? <tr><td colSpan={6}>저장된 제재 이력이 없습니다.</td></tr> : entries.map((entry) => <tr key={entry.id}><td><b>{entry.server_title}</b><small>{entry.address}:{entry.port}</small></td><td>{enforcementKindLabel(entry.kind)}</td><td>{entry.reason}</td><td>{dateTime(entry.starts_at)}<small>{entry.expires_at ? `종료 ${dateTime(entry.expires_at)}` : "수동 해제까지"}</small></td><td><Status value={entry.status} /></td><td>{entry.created_by}<small>{entry.resolved_by ? `해제 ${entry.resolved_by}` : ""}</small></td></tr>)}</tbody></table></div>
  </section>;
}

function enforcementKindLabel(kind: ServerEnforcement["kind"]) { return kind === "warning" ? "경고" : kind === "suspension" ? "임시 차단" : "블라인드"; }

function VoteLogControl({ servers }: { servers: AdminServer[] }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [serverId, setServerId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<VoteLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [blockTarget, setBlockTarget] = useState<VoteLog | null>(null);
  const [blockReason, setBlockReason] = useState("추천 스팸 및 부정 이용");
  const [blockDuration, setBlockDuration] = useState("7d");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const parameters = new URLSearchParams({ page: String(page), limit: "50" });
      if (query) parameters.set("q", query);
      if (serverId) parameters.set("serverId", serverId);
      const response = await fetch(`/api/admin/votes?${parameters}`, { cache: "no-store" });
      const body = await response.json() as VoteLogResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "추천 기록을 불러오지 못했습니다.");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추천 기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [page, query, serverId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = draftQuery.trim();
    setPage(1);
    if (nextQuery === query) void load(); else setQuery(nextQuery);
  };
  const reset = () => { setDraftQuery(""); setQuery(""); setServerId(""); setPage(1); };
  const createBlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!blockTarget) return;
    setLoading(true); setError(""); setActionNotice("");
    try {
      const expiresAt = Math.floor(Date.now() / 1000) + (VOTE_BLOCK_SECONDS[blockDuration] ?? VOTE_BLOCK_SECONDS["7d"]);
      await jsonRequest("/api/admin/vote-blocks", "POST", { voteId: blockTarget.id, reason: blockReason, expiresAt });
      setActionNotice(`${blockTarget.ipMasked} 접속 환경을 ${blockDuration.replace("d", "일")} 동안 추천 차단했습니다.`);
      setBlockTarget(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추천 차단에 실패했습니다.");
      setLoading(false);
    }
  };
  const revokeBlock = async (entry: VoteLog) => {
    if (!entry.ipBlock) return;
    setLoading(true); setError(""); setActionNotice("");
    try {
      const response = await fetch(`/api/admin/vote-blocks/${entry.ipBlock.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "추천 차단 해제에 실패했습니다.");
      setActionNotice(`${entry.ipMasked} 접속 환경의 추천 차단을 해제했습니다.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추천 차단 해제에 실패했습니다.");
      setLoading(false);
    }
  };
  const summary = data?.summary ?? { total: 0, today: 0, uniquePlayers: 0, uniqueSources: 0 };

  return <section className="admin-panel admin-vote-log-panel">
    <div className="admin-section-head"><div><span className="admin-eyebrow">VOTE ACTIVITY LOG</span><h2>서버 추천 기록</h2><p>추천 시각·서버·Minecraft 계정과 가명 처리된 접속 환경을 조회합니다.</p></div><span>{data?.pagination.total.toLocaleString() ?? 0}건 검색됨</span></div>
    <div className="admin-vote-summary">
      <article><Trophy /><span><b>{summary.total.toLocaleString()}</b><small>검색 결과</small></span></article>
      <article><Clock3 /><span><b>{summary.today.toLocaleString()}</b><small>오늘 추천</small></span></article>
      <article><ShieldCheck /><span><b>{summary.uniquePlayers.toLocaleString()}</b><small>고유 계정</small></span></article>
      <article><BarChart3 /><span><b>{summary.uniqueSources.toLocaleString()}</b><small>고유 접속 환경</small></span></article>
    </div>
    <form className="admin-vote-search" onSubmit={search}>
      <label><span>서버 필터</span><select value={serverId} onChange={(event) => { setServerId(event.target.value); setPage(1); }}><option value="">전체 서버</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.title}{server.deletedAt ? " · 삭제됨" : ""}</option>)}</select></label>
      <label className="query"><span>통합 검색</span><div><Search size={15} /><input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="서버명 · 주소 · 운영자 · 닉네임 · UUID · 정확한 IP" maxLength={100} /></div></label>
      <button className="admin-primary" type="submit" disabled={loading}>검색</button><button type="button" onClick={reset} disabled={loading || (!query && !serverId)}>초기화</button>
    </form>
    <div className="admin-vote-privacy"><ShieldCheck size={15} /><span><b>IP 최소 수집</b> 원문 IP는 저장하지 않습니다. 화면에는 마스킹 주소만 표시하며 정확한 IP 검색은 복구 불가능한 대조 해시로 처리합니다. IP 정보는 90일 후 자동 삭제됩니다.</span></div>
    {blockTarget && <form className="admin-vote-block-editor" onSubmit={createBlock}>
      <header><div><Ban size={17} /><span><b>추천 접속 환경 차단</b><small>{blockTarget.serverTitle} · {blockTarget.nickname} · {blockTarget.ipMasked}</small></span></div><button type="button" onClick={() => setBlockTarget(null)}>취소</button></header>
      <label><span>차단 사유</span><input autoFocus value={blockReason} minLength={3} maxLength={500} onChange={(event) => setBlockReason(event.target.value)} /></label>
      <label><span>차단 기간</span><select value={blockDuration} onChange={(event) => setBlockDuration(event.target.value)}><option value="1d">1일</option><option value="7d">7일</option><option value="30d">30일</option><option value="90d">90일</option></select></label>
      <button className="admin-inline-danger" disabled={loading || blockReason.trim().length < 3}>동일 IP 추천 차단</button>
    </form>}
    {actionNotice && <div className="admin-vote-action-notice" role="status"><ShieldCheck size={15} />{actionNotice}</div>}
    {error ? <div className="admin-form-error">{error}</div> : loading && !data ? <Empty text="추천 기록 불러오는 중…" /> : data?.logs.length ? <>
      <div className="admin-table-wrap admin-vote-table"><table><thead><tr><th>추천 시각</th><th>서버</th><th>추천자</th><th>IP 정보</th><th>추천일</th><th>상태</th><th>스팸 관리</th></tr></thead><tbody>{data.logs.map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}<small>ID {entry.id.slice(0, 10)}</small></td><td><b>{entry.serverTitle}</b><small>{entry.serverAddress} · {entry.ownerEmail}</small></td><td><b>{entry.nickname}</b><small>{entry.minecraftUuid ? `UUID ${entry.minecraftUuid}` : "기존 기록 · UUID 없음"}</small></td><td><code>{entry.ipMasked}</code><small>{entry.ipKey ? `${entry.ipVersion === 6 ? "IPv6" : entry.ipVersion === 4 ? "IPv4" : "LOCAL"} · KEY ${entry.ipKey}` : "기존 기록 · IP 정보 없음"}</small>{entry.ipMetadataExpiresAt && <small>IP 정보 삭제 {dateTime(entry.ipMetadataExpiresAt)}</small>}{entry.ipBlock && <small className="admin-vote-blocked">추천 차단 중 · {dateTime(entry.ipBlock.expiresAt)}까지</small>}</td><td>{entry.voteDay}</td><td><Status value={entry.rewardStatus} /></td><td className="admin-vote-block-cell">{entry.ipBlock ? <button className="is-blocked" disabled={loading} onClick={() => void revokeBlock(entry)}>차단 해제</button> : <button disabled={loading || !entry.ipKey} onClick={() => { setBlockTarget(entry); setBlockReason("추천 스팸 및 부정 이용"); setBlockDuration("7d"); }}>IP 차단</button>}<small>{entry.ipBlock?.reason ?? (!entry.ipKey ? "차단 정보 없음" : "원본 IP 저장 불필요")}</small></td></tr>)}</tbody></table></div>
      <div className="admin-vote-pagination"><span>{data.pagination.page.toLocaleString()} / {data.pagination.totalPages.toLocaleString()} 페이지</span><div><button disabled={loading || data.pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button><button disabled={loading || data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((current) => Math.min(data.pagination.totalPages, current + 1))}>다음</button></div></div>
    </> : <Empty text="조건에 맞는 추천 기록이 없습니다." />}
  </section>;
}

function BlacklistControl({ entries, busy, run, refresh }: { entries: BlacklistEntry[] } & Pick<ControlProps, "busy" | "run" | "refresh">) {
  const [kind, setKind] = useState<"address" | "ip">("address"); const [value, setValue] = useState(""); const [reason, setReason] = useState(""); const [expiry, setExpiry] = useState("");
  const active = entries.filter((entry) => entry.status === "active");
  return <section className="admin-panel"><div className="admin-section-head"><div><span className="admin-eyebrow">ACCESS DENY</span><h2>블랙리스트 서버 관리</h2></div><span>{active.length}개 활성</span></div><div className="admin-blacklist-form"><label>차단 기준<select value={kind} onChange={(event) => setKind(event.target.value as "address" | "ip")}><option value="address">서버 주소</option><option value="ip">서버 IP</option></select></label><label>차단 값<input value={value} onChange={(event) => setValue(event.target.value)} placeholder={kind === "address" ? "play.example.kr" : "203.0.113.10"} /></label><label>만료일 (선택)<input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label><label className="span-2">차단 사유<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="정책 위반 내용을 구체적으로 입력" /></label><button className="admin-primary" disabled={busy || !value || reason.length < 3} onClick={() => run(async () => { await jsonRequest("/api/admin/blacklist", "POST", { kind, value, reason, expiresAt: toUnix(expiry) }); setValue(""); setReason(""); setExpiry(""); await refresh(); }, "블랙리스트에 추가했습니다.")}>차단 등록</button></div><div className="admin-table-wrap"><table><thead><tr><th>상태</th><th>기준</th><th>값</th><th>사유</th><th>등록일 / 만료일</th><th></th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><Status value={entry.status} /></td><td>{entry.kind === "ip" ? "IP" : "주소"}</td><td><code>{entry.value}</code></td><td>{entry.reason}</td><td>{dateTime(entry.created_at)}<small>{entry.expires_at ? `만료 ${dateTime(entry.expires_at)}` : "영구"}</small></td><td>{entry.status === "active" && <button className="admin-inline-danger" disabled={busy} onClick={() => run(async () => { const response = await fetch(`/api/admin/blacklist/${entry.id}`, { method: "DELETE" }); if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "해제 실패"); await refresh(); }, "차단을 해제하고 이전 서버 상태를 복구했습니다.")}>해제</button>}</td></tr>)}</tbody></table></div></section>;
}

function MessageControl({ conversations, servers, busy, run, refresh, realtimeEvent, connectionStatus }: { conversations: Conversation[]; realtimeEvent: ChatRealtimeEvent | null; connectionStatus: ChatConnectionStatus } & ControlProps) {
  const initialId = conversations[0]?.server_id ?? servers[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(initialId); const [messages, setMessages] = useState<Message[]>([]); const [body, setBody] = useState(""); const [loading, setLoading] = useState(false);
  const options = useMemo(() => servers.map((server) => ({ ...server, conversation: conversations.find((item) => item.server_id === server.id) })), [servers, conversations]);
  const load = useCallback(async (id: string) => { if (!id) return; setLoading(true); try { const response = await fetch(`/api/admin/messages/${id}`, { cache: "no-store" }); const data = await response.json() as { messages?: Message[]; error?: string }; if (!response.ok) throw new Error(data.error); setMessages(data.messages ?? []); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(selectedId); }, 0); return () => window.clearTimeout(timer); }, [selectedId, load]);
  useEffect(() => {
    if (!realtimeEvent || realtimeEvent.serverId !== selectedId) return;
    const timer = window.setTimeout(() => {
      setMessages((current) => current.some((item) => item.id === realtimeEvent.message.id) ? current : [...current, realtimeEvent.message]);
      void load(selectedId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, realtimeEvent, selectedId]);
  const selected = servers.find((item) => item.id === selectedId);
  if (!selected) return <Empty text="대화할 서버가 없습니다." />;
  return <section className="admin-chat-layout"><aside className="admin-chat-list"><div className="admin-list-title">서버 운영자</div>{options.map((server) => <button key={server.id} className={selectedId === server.id ? "active" : ""} onClick={() => setSelectedId(server.id)}><span>{server.title}</span><small>{server.ownerEmail}</small>{Boolean(server.conversation?.unread_admin) && <b>{server.conversation?.unread_admin}</b>}</button>)}</aside><div className="admin-chat-panel"><header><div><h2>{selected.title}</h2><span>{selected.ownerEmail} · {selected.address}</span></div><div className="admin-chat-head-actions"><AdminRealtimeBadge status={connectionStatus} /><button onClick={() => load(selected.id)}><RefreshCw size={15} /></button></div></header><div className="admin-chat-messages">{loading ? <Empty text="대화 불러오는 중…" /> : messages.length ? messages.map((message) => <article key={message.id} className={message.sender_role === "admin" ? "mine" : "theirs"}><span>{message.sender_role === "admin" ? "총관리자" : "서버 운영자"}</span><p>{message.body}</p><time>{dateTime(message.created_at)}</time></article>) : <Empty text="첫 메시지를 보내 직통라인을 시작하세요." />}</div><form onSubmit={(event) => { event.preventDefault(); if (!body.trim()) return; void run(async () => { await jsonRequest(`/api/admin/messages/${selected.id}`, "POST", { body }); setBody(""); await load(selected.id); await refresh(); }, "메시지를 전송했습니다."); }}><textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="메시지 입력 · Enter 전송 · Shift+Enter 줄바꿈" /><button className="admin-primary" disabled={busy || !body.trim()}>전송</button></form></div></section>;
}

function AdminRealtimeBadge({ status }: { status: ChatConnectionStatus }) {
  const label = status === "live" ? "LIVE" : status === "connecting" || status === "reconnecting" ? "CONNECTING" : "OFFLINE";
  return <span className={`admin-realtime-badge status-${status}`}><i />{label}</span>;
}

function CacheControl({ busy, run }: Pick<ControlProps, "busy" | "run">) {
  const [stats, setStats] = useState<BroadcastCacheStats | null>(null);
  const [lastCleanup, setLastCleanup] = useState<BroadcastCacheCleanup | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin/cache", { cache: "no-store" });
    const data = await response.json() as { stats?: BroadcastCacheStats; error?: string };
    if (!response.ok || !data.stats) throw new Error(data.error || "캐시 현황을 불러오지 못했습니다.");
    setStats(data.stats);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "캐시 현황을 불러오지 못했습니다.")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const clean = () => run(async () => {
    const response = await fetch("/api/admin/cache", { method: "DELETE" });
    const data = await response.json() as { cleanup?: BroadcastCacheCleanup; stats?: BroadcastCacheStats; error?: string };
    if (!response.ok || !data.cleanup || !data.stats) throw new Error(data.error || "캐시 정리에 실패했습니다.");
    setLastCleanup(data.cleanup);
    setStats(data.stats);
  }, "종료된 방송 캐시를 정리했습니다.");
  return <section className="admin-panel admin-cache-panel">
    <div className="admin-section-head"><div><span className="admin-eyebrow">EPHEMERAL MEDIA</span><h2>방송 이미지 캐시</h2><p>5분마다 현재 라이브 목록과 비교해 종료된 방송의 미리보기와 프로필 이미지를 자동 삭제합니다.</p></div><button type="button" onClick={() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "캐시 현황을 불러오지 못했습니다."))} disabled={busy}><RefreshCw size={15} /> 현황 갱신</button></div>
    {error && <div className="admin-form-error">{error}</div>}
    {stats ? <div className="admin-cache-summary">
      <article><small>전체 캐시</small><b>{stats.objects.toLocaleString()}개</b><span>{formatBytes(stats.bytes)}</span></article>
      <article><small>방송 미리보기</small><b>{stats.byKind.preview.objects.toLocaleString()}개</b><span>{formatBytes(stats.byKind.preview.bytes)}</span></article>
      <article><small>스트리머 프로필</small><b>{stats.byKind.profile.objects.toLocaleString()}개</b><span>{formatBytes(stats.byKind.profile.bytes)}</span></article>
      <article><small>플랫폼</small><b>CHZZK {stats.byPlatform.chzzk.objects}</b><span>SOOP {stats.byPlatform.soop.objects}</span></article>
    </div> : <div className="admin-empty">캐시 사용량을 확인하는 중…</div>}
    {lastCleanup && <div className="admin-cache-result"><ShieldCheck size={17} /><span><b>{lastCleanup.deleted.toLocaleString()}개 · {formatBytes(lastCleanup.deletedBytes)} 삭제</b><small>{lastCleanup.retained.toLocaleString()}개 유지{lastCleanup.skippedPlatforms.length ? ` · 응답 지연으로 ${lastCleanup.skippedPlatforms.join(", ")} 보존` : " · 모든 플랫폼 확인 완료"}</small></span></div>}
    <div className="admin-cache-action"><div><h3>지금 정리</h3><p>서버 아이콘·배너·상세소개 이미지는 건드리지 않고 방송 캐시만 삭제합니다. 라이브 소스 응답이 지연된 플랫폼은 안전하게 보존합니다.</p></div><button className="admin-danger-button" type="button" onClick={() => void clean()} disabled={busy || !stats}>{busy ? "정리 중…" : <><Trash2 size={15} /> 종료 방송 캐시 정리</>}</button></div>
  </section>;
}

type AnnouncementFormState = {
  title: string;
  summary: string;
  detail: string;
  status: "draft" | "published";
  startsAt: string;
  endsAt: string;
  revision: number | null;
};

function freshAnnouncementForm(): AnnouncementFormState {
  const now = Math.floor(Date.now() / 60_000) * 60;
  return {
    title: "",
    summary: "",
    detail: "",
    status: "published",
    startsAt: toKstInput(now),
    endsAt: toKstInput(now + 2 * 60 * 60),
    revision: null,
  };
}

function AnnouncementControl({ entries, busy, run, refresh, now }: {
  entries: AdminAnnouncement[];
  busy: boolean;
  run: ControlProps["run"];
  refresh: () => Promise<void>;
  now: number;
}) {
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<AnnouncementFormState>(() => freshAnnouncementForm());
  const isEditing = editingId.length > 0;
  const activeCount = entries.filter((entry) => announcementPhase(entry, now) === "active").length;
  const scheduledCount = entries.filter((entry) => announcementPhase(entry, now) === "scheduled").length;

  const reset = () => {
    setEditingId("");
    setForm(freshAnnouncementForm());
  };
  const edit = (entry: AdminAnnouncement) => {
    if (entry.deletedAt != null) return;
    setEditingId(entry.id);
    setForm({
      title: entry.title,
      summary: entry.summary,
      detail: entry.detail,
      status: entry.status === "published" ? "published" : "draft",
      startsAt: toKstInput(entry.startsAt),
      endsAt: toKstInput(entry.endsAt),
      revision: entry.revision,
    });
  };
  const setDuration = (seconds: number) => setForm((current) => {
    const startsAt = fromKstInput(current.startsAt) ?? Math.floor(Date.now() / 60_000) * 60;
    return { ...current, endsAt: toKstInput(startsAt + seconds) };
  });
  const refreshBestEffort = async () => {
    try {
      await refresh();
    } catch {
      window.setTimeout(() => void refresh().catch(() => undefined), 1_500);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const startsAt = fromKstInput(form.startsAt);
      const endsAt = fromKstInput(form.endsAt);
      if (startsAt == null || endsAt == null) throw new Error("공지 시작일과 종료일을 KST 기준으로 입력해 주세요.");
      const payload = { ...form, startsAt, endsAt, revision: form.revision ?? undefined };
      if (isEditing) await jsonRequest(`/api/admin/announcements/${editingId}`, "PATCH", payload);
      else await jsonRequest("/api/admin/announcements", "POST", payload);
      reset();
      window.dispatchEvent(new Event("site-announcements:refresh"));
      await refreshBestEffort();
    }, isEditing ? "공지사항을 수정했습니다." : "공지사항을 저장했습니다.");
  };
  const archive = () => {
    if (!isEditing || form.revision == null) return;
    if (!window.confirm(`“${form.title}” 공지를 내리고 보관할까요? 방문자 화면에서 즉시 사라집니다.`)) return;
    void run(async () => {
      await jsonRequest(`/api/admin/announcements/${editingId}`, "DELETE", { revision: form.revision });
      reset();
      window.dispatchEvent(new Event("site-announcements:refresh"));
      await refreshBestEffort();
    }, "공지사항을 내리고 기록으로 보관했습니다.");
  };

  return <section className="admin-panel admin-announcement-panel">
    <div className="admin-section-head">
      <div><span className="admin-eyebrow">SCHEDULED SERVICE NOTICE</span><h2>전 페이지 공지사항</h2><p>설정한 KST 기간에만 모든 페이지 최상단에 고정되며, 방문자가 누르면 상세 안내가 열립니다.</p></div>
      <div className="admin-announcement-summary"><span><b>{activeCount}</b> 현재 게시</span><span><b>{scheduledCount}</b> 예약</span><button type="button" onClick={reset}><Plus size={14} /> 새 공지</button></div>
    </div>
    <div className="admin-announcement-layout">
      <form className="admin-announcement-form" onSubmit={submit}>
        <div className="admin-announcement-form-head"><div><Megaphone size={18} /><span><b>{isEditing ? "공지 수정" : "새 공지 작성"}</b><small>{isEditing ? `revision ${form.revision}` : "기간과 내용을 입력해 바로 예약할 수 있습니다."}</small></span></div>{isEditing && <button type="button" onClick={reset}>편집 취소</button>}</div>
        <label>공지 제목 <span>{form.title.length}/120</span><input value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="예: 정기 서버 점검 안내" required /></label>
        <label>상단 배너 요약 <span>{form.summary.length}/300</span><input value={form.summary} maxLength={300} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="점검 시간과 영향을 짧게 알려주세요." required /></label>
        <div className="admin-announcement-grid">
          <label>게시 상태<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "draft" | "published" })}><option value="published">게시·예약</option><option value="draft">임시저장</option></select></label>
          <label>시작일 · KST<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></label>
          <label>종료일 · KST<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required /></label>
        </div>
        <div className="admin-announcement-presets" aria-label="공지 기간 빠른 설정"><span>기간 빠른 설정</span>{([["1시간", 3_600], ["6시간", 21_600], ["1일", 86_400], ["3일", 259_200], ["7일", 604_800]] as const).map(([label, seconds]) => <button type="button" key={label} onClick={() => setDuration(seconds)}>{label}</button>)}</div>
        <label>상세 내용 <span>{form.detail.length}/5,000</span><textarea value={form.detail} maxLength={5_000} onChange={(event) => setForm({ ...form, detail: event.target.value })} placeholder={"점검 사유, 영향 범위, 예상 종료 시각과 이용자 안내를 자세히 입력하세요.\n줄바꿈은 상세 팝업에 그대로 표시됩니다."} required /></label>
        <div className="admin-announcement-preview" aria-label="공지 배너 미리보기"><span><Megaphone size={13} /> 공지</span><div><b>{form.title || "공지 제목 미리보기"}</b><small>{form.summary || "상단 배너에 표시될 짧은 안내입니다."}</small></div></div>
        <div className="admin-announcement-actions">
          {isEditing && <button className="admin-inline-danger" type="button" disabled={busy} onClick={archive}><Trash2 size={14} /> 공지 내리기</button>}
          <button className="admin-primary" type="submit" disabled={busy}><Save size={14} /> {busy ? "저장 중…" : isEditing ? "변경사항 저장" : "공지 저장"}</button>
        </div>
      </form>
      <aside className="admin-announcement-list">
        <div className="admin-list-title">공지 이력 · {entries.length}건</div>
        {entries.length ? entries.map((entry) => {
          const phase = announcementPhase(entry, now);
          return <article key={entry.id} className={`${editingId === entry.id ? "active " : ""}${entry.deletedAt != null ? "deleted" : ""}`}>
            <button type="button" onClick={() => edit(entry)} disabled={entry.deletedAt != null}>
              <span className="admin-announcement-item-head"><b>{entry.title}</b><i className={`phase-${phase}`}>{announcementPhaseLabel(phase)}</i></span>
              <small>{entry.summary}</small>
              <time>{announcementDateTime(entry.startsAt)}<br />– {announcementDateTime(entry.endsAt)}</time>
              {entry.deletedAt == null && <em><Pencil size={12} /> 수정</em>}
            </button>
          </article>;
        }) : <Empty text="작성된 공지사항이 없습니다." />}
      </aside>
    </div>
  </section>;
}

function announcementPhaseLabel(phase: string) {
  return ({
    active: "게시 중",
    scheduled: "예약",
    expired: "종료",
    draft: "임시저장",
    archived: "보관",
    deleted: "삭제됨",
  } as Record<string, string>)[phase] ?? phase;
}

function AuditLog({ entries }: { entries: Audit[] }) {
  return <section className="admin-panel"><div className="admin-section-head"><div><span className="admin-eyebrow">IMMUTABLE TRAIL</span><h2>관리자 감사 로그</h2></div><span>최근 {entries.length}건</span></div><div className="admin-table-wrap"><table><thead><tr><th>시각</th><th>관리자</th><th>작업</th><th>대상</th><th>요약</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{dateTime(entry.created_at)}</td><td>{entry.admin_email}</td><td><code>{entry.action}</code></td><td>{entry.target_type}<small>{entry.target_id}</small></td><td className="admin-json">{JSON.stringify(entry.details)}</td></tr>)}</tbody></table></div></section>;
}

type ControlProps = { servers: AdminServer[]; busy: boolean; run: (work: () => Promise<void>, message: string) => Promise<void>; refresh: () => Promise<void> };
function ControlLayout({ list, children }: { list: React.ReactNode; children: React.ReactNode }) { return <section className="admin-control-layout"><aside className="admin-server-list"><div className="admin-list-title">서버 목록</div>{list}</aside><div className="admin-control-panel">{children}</div></section>; }
function ServerList({ servers, selectedId, onSelect, premium = false }: { servers: AdminServer[]; selectedId: string; onSelect: (id: string) => void; premium?: boolean }) { return <>{servers.map((server) => <button key={server.id} className={selectedId === server.id ? "active" : ""} onClick={() => onSelect(server.id)}><span>{server.title}{premium && server.premiumActive && <Crown size={13} />}</span><small>{server.address}:{server.port}</small><Status value={server.status} /></button>)}</>; }
function ControlHeading({ server }: { server: AdminServer }) { return <header className="admin-control-heading"><div><span className="admin-eyebrow">SERVER CONTROL</span><h2>{server.title}</h2><p>{server.ownerEmail} · <code>{server.address}:{server.port}</code></p></div><Status value={server.status} /></header>; }
function Status({ value }: { value: string }) { return <span className={`admin-status status-${value}`}>{value}</span>; }
function Empty({ text }: { text: string }) { return <div className="admin-empty">{text}</div>; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
async function jsonRequest(url: string, method: string, body: unknown) { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "요청에 실패했습니다."); return response.json().catch(() => ({})); }
