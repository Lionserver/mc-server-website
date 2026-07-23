"use client";
/* eslint-disable @next/next/no-img-element -- Minecraft skin heads are exact-size external pixel art with an error fallback. */

import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { useRouter } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { readThemePreference, storeThemePreference } from "@/lib/browser-preferences.mjs";
import {
  Activity, ArrowRightLeft, ArrowUpRight, BadgeCheck, Check, CheckCircle2, ChevronDown, ChevronUp, Clock3, Code2, Copy,
  ExternalLink, MessageCircle, Search, ShieldCheck, Signal,
  Star, Ticket, Trophy, Users, X,
} from "lucide-react";
import { ServerRegistrationDialog } from "@/components/server-registration-dialog";
import { MinecraftHead } from "@/components/minecraft-head";
import { PublicSiteHeader } from "@/components/public-site-header";
import { descriptionFontFamilies, descriptionTextRuns, type DescriptionDocument, type DescriptionTextRun } from "@/lib/server-description";

type Edition = "ALL" | "JE" | "BE";
type SortKey = "recommended" | "newest" | "players" | "latency" | "trust";
type ThemeMode = "light" | "dark";
type DirectoryView = "all" | "small" | "new";

type Server = {
  id: string;
  name: string;
  host: string;
  port: number;
  address: string;
  edition: "JE" | "BE" | "JE + BE";
  version: string;
  summary: string;
  players: number;
  capacity: number;
  latency: number;
  uptime: number;
  trust: number;
  trustGrade: "S" | "A" | "B" | "C" | "D";
  trustLabel: string;
  trustBreakdown: Array<{
    key: "ownership" | "bridge" | "uptime" | "recentStatus" | "policy" | "history";
    label: string;
    score: number;
    maxScore: number;
    state: "earned" | "partial" | "missing" | "penalty";
    detail: string;
  }>;
  enforcementSummary: { warnings: number; serious: number; active: number };
  votes: number;
  growth: number;
  averagePlayers7d: number | null;
  tags: string[];
  verified: boolean;
  online: boolean;
  statusSource: "bridge" | "ping" | "none";
  bridgeStatus: "live" | "stale" | "not_connected";
  sponsored: boolean;
  hasIcon: boolean;
  iconContentType: string | null;
  iconTransform: { focusX: number; focusY: number; zoom: number };
  hasListBanner: boolean;
  hasDetailBanner: boolean;
  bannerContentTypes: {
    desktopList: string | null;
    mobileList: string | null;
    desktopDetail: string | null;
    mobileDetail: string | null;
  };
  bannerTransforms: Record<"desktopList" | "mobileList" | "desktopDetail" | "mobileDetail", { focusX: number; focusY: number; zoom: number }>;
  description: string;
  descriptionDocument: DescriptionDocument;
  discordUrl: string;
  discordEnabled: boolean;
  websiteUrl: string;
  websiteEnabled: boolean;
  kakaoUrl: string;
  kakaoEnabled: boolean;
  staffIntroEnabled: boolean;
  staff: Array<{ id: string; role: string; nickname: string; minecraftUuid: string | null; introduction: string; discordEnabled: boolean; discordUrl: string; sortOrder: number }>;
  recentVotes: Array<{ id: string; nickname: string; minecraftUuid: string | null; rewardStatus: string; createdAt: number }>;
  monthlyTop: Array<{ nickname: string; minecraftUuid: string | null; count: number }>;
  trend: Array<{ bucketAt: number; day: string; players: number; maxPlayers: number; samples: number; source: "bridge" | "ping" | "mixed" }>;
  trendSource: "bridge" | "ping" | "mixed" | "none";
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type ClaimStart = {
  claim: { id: string; serverId: string; serverTitle: string; method: "motd" | "dns"; status: string };
  verificationToken: string;
  challenge: { method: "motd"; marker: string; label: string } | { method: "dns"; host: string; recordType: string; value: string; label: string };
};

type TrendChartPoint = {
  timestamp: number;
  date: string;
  players: number;
  capacityRate: number;
  source: "bridge" | "ping" | "mixed";
  delta: number | null;
  isPeak: boolean;
  isLow: boolean;
  isCurrent: boolean;
};

const number = new Intl.NumberFormat("ko-KR");
const formatPlayers = (value: number) => number.format(value);
const NEW_SERVER_WINDOW_SECONDS = 7 * 86_400;

export default function Home() {
  const router = useRouter();
  const [directoryView, setDirectoryView] = useState<DirectoryView>("all");
  const [query, setQuery] = useState("");
  const [edition, setEdition] = useState<Edition>("ALL");
  const [category, setCategory] = useState("전체");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [servers, setServers] = useState<Server[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryUpdatedAt, setDirectoryUpdatedAt] = useState<number | null>(null);
  const [directoryConnection, setDirectoryConnection] = useState<"connecting" | "live" | "polling">("connecting");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<Server | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [claimTarget, setClaimTarget] = useState<Server | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimStart | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");
  const [ownerSession, setOwnerSession] = useState<{ email: string } | null>(null);
  const [ownerSessionChecked, setOwnerSessionChecked] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  const changeDirectoryView = useCallback((view: DirectoryView) => {
    setDirectoryView(view);
    setSort((current) => view === "new" ? "newest" : current === "newest" ? "recommended" : current);
    setMobileOpen(false);
    const url = new URL(window.location.href);
    if (view === "small" || view === "new") url.searchParams.set("view", view);
    else url.searchParams.delete("view");
    url.hash = "server-list";
    window.history.replaceState({}, "", url);
    window.requestAnimationFrame(() => document.getElementById("server-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const refreshSelected = useCallback(async (serverId: string) => {
    const response = await fetch(`/api/servers/${serverId}?public=1`, { cache: "no-store" });
    const body = await response.json() as { server?: Server };
    if (response.ok && body.server) {
      setSelected(body.server);
      setServers((current) => current.map((server) => server.id === body.server?.id ? { ...server, ...body.server } : server));
    } else if (response.status === 404 && selectedIdRef.current === serverId) {
      setSelected(null);
      showToast("삭제되었거나 더 이상 공개되지 않는 서버입니다.");
    }
  }, [showToast]);

  const openServer = useCallback(async (server: Server) => {
    setSelected(server);
    try {
      const response = await fetch(`/api/servers/${server.id}?public=1`, { cache: "no-store" });
      const body = await response.json() as { server?: Server; error?: string };
      if (!response.ok || !body.server) throw new Error(body.error ?? "서버 상세정보를 불러오지 못했습니다.");
      setSelected(body.server);
    } catch (error) {
      setSelected(null);
      showToast(error instanceof Error ? error.message : "서버 상세정보 불러오기 실패");
    }
  }, [showToast]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, { value: string; count: number }>();
    for (const server of servers) {
      const seen = new Set<string>();
      for (const tag of server.tags) {
        const key = tag.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const current = counts.get(key);
        counts.set(key, { value: current?.value ?? tag.trim(), count: (current?.count ?? 0) + 1 });
      }
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ko-KR"));
    return [
      { value: "전체", label: `전체 (${servers.length})` },
      ...ranked.map((item) => ({ value: item.value, label: `${item.value} (${item.count})` })),
    ];
  }, [servers]);
  const effectiveCategory = category === "전체" || categoryOptions.some((option) => option.value === category) ? category : "전체";

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = servers.filter((server) => {
      const editionMatch = edition === "ALL" || server.edition === edition || server.edition.includes(edition);
      const categoryMatch = effectiveCategory === "전체" || server.tags.some((tag) => tag.toLowerCase() === effectiveCategory.toLowerCase());
      const queryMatch = !normalized || [server.name, server.address, server.summary, ...server.tags].join(" ").toLowerCase().includes(normalized);
      const directoryMatch = directoryView === "all"
        || (directoryView === "small" && server.averagePlayers7d !== null && server.averagePlayers7d < 20)
        || (directoryView === "new" && directoryUpdatedAt !== null && server.createdAt >= directoryUpdatedAt - NEW_SERVER_WINDOW_SECONDS);
      return directoryMatch && editionMatch && categoryMatch && queryMatch && (!onlineOnly || server.online);
    });
    return [...list].sort((a, b) => {
      if (sort === "newest") return b.createdAt - a.createdAt;
      if (sort === "players") return b.players - a.players;
      if (sort === "latency") return a.latency - b.latency;
      if (sort === "trust") return b.trust - a.trust;
      if (directoryView === "small") {
        if (a.online !== b.online) return Number(b.online) - Number(a.online);
        if (a.trust !== b.trust) return b.trust - a.trust;
      }
      return b.votes - a.votes;
    });
  }, [query, edition, effectiveCategory, onlineOnly, sort, servers, directoryView, directoryUpdatedAt]);

  const smallServerPool = useMemo(() => servers.filter((server) => server.averagePlayers7d !== null && server.averagePlayers7d < 20), [servers]);
  const smallOnlineCount = smallServerPool.filter((server) => server.online).length;
  const smallBridgeCount = smallServerPool.filter((server) => server.bridgeStatus === "live").length;
  const newServerPool = useMemo(() => {
    if (directoryUpdatedAt === null) return [];
    const threshold = directoryUpdatedAt - NEW_SERVER_WINDOW_SECONDS;
    return servers.filter((server) => server.createdAt >= threshold);
  }, [directoryUpdatedAt, servers]);
  const newOnlineCount = newServerPool.filter((server) => server.online).length;
  const newBridgeCount = newServerPool.filter((server) => server.bridgeStatus === "live").length;

  const loadServers = useCallback(async (quiet = false) => {
    if (!quiet) setDirectoryLoading(true);
    try {
      const response = await fetch("/api/servers?limit=100", { cache: "no-store" });
      const body = await response.json() as { servers?: Server[]; generatedAt?: number; error?: string };
      if (!response.ok || !body.servers) throw new Error(body.error ?? "서버 목록을 불러오지 못했습니다.");
      setServers(body.servers);
      setDirectoryUpdatedAt(body.generatedAt ?? Math.floor(Date.now() / 1000));
    } catch (error) {
      if (!quiet) setToast(error instanceof Error ? error.message : "서버 목록 불러오기 실패");
    } finally {
      if (!quiet) setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadServers(), 0);
    const timer = window.setInterval(() => {
      void loadServers(true);
      if (selectedIdRef.current) void refreshSelected(selectedIdRef.current);
    }, 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadServers, refreshSelected]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView === "small" || requestedView === "new") {
        setDirectoryView(requestedView);
        if (requestedView === "new") setSort("newest");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const syncSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const body = await response.json() as { authenticated?: boolean; email?: string };
        if (!active) return;
        setOwnerSession(response.ok && body.authenticated && body.email ? { email: body.email } : null);
      } catch {
        if (active) setOwnerSession(null);
      } finally {
        if (active) setOwnerSessionChecked(true);
      }
    };
    void syncSession();
    window.addEventListener("focus", syncSession);
    return () => { active = false; window.removeEventListener("focus", syncSession); };
  }, []);

  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnect: number | null = null;
    let attempts = 0;
    const connect = () => {
      if (!active) return;
      setDirectoryConnection("connecting");
      const url = new URL("/api/realtime/directory", window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.addEventListener("open", () => { attempts = 0; setDirectoryConnection("live"); });
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") return;
        try {
          const event = JSON.parse(message.data) as { type?: string; serverId?: string };
          if (event.type !== "directory.updated") return;
          void loadServers(true);
          if (selectedIdRef.current === event.serverId) void refreshSelected(event.serverId);
        } catch { /* malformed frames are ignored */ }
      });
      socket.addEventListener("close", () => {
        socket = null;
        if (!active) return;
        attempts += 1;
        setDirectoryConnection("polling");
        reconnect = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempts, 5)));
      });
      socket.addEventListener("error", () => socket?.close());
    };
    connect();
    return () => {
      active = false;
      if (reconnect !== null) window.clearTimeout(reconnect);
      socket?.close(1000, "page closed");
    };
  }, [loadServers, refreshSelected]);

  useEffect(() => {
    const next = readThemePreference();
    document.documentElement.dataset.theme = next;
    const frame = window.requestAnimationFrame(() => setTheme(next));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setRegistrationOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const claimServerId = params.get("claim");
      const detailServerId = params.get("server");
      const detailServer = detailServerId ? servers.find((item) => item.id === detailServerId) : undefined;
      if (detailServer) {
        void openServer(detailServer);
        params.delete("server");
        const nextQuery = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
      }
      const server = claimServerId ? servers.find((item) => item.id === claimServerId) : undefined;
      if (!server) return;
      fetch("/api/auth/session", { cache: "no-store" }).then((response) => {
        if (!active || !response.ok) return;
        setSelected(null);
        setClaimTarget(server);
        setClaimResult(null);
        setClaimMessage("");
      }).catch(() => undefined);
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [servers, openServer]);

  useEffect(() => {
    if (!ownerSessionChecked) return;
    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("register") !== "1") return;
      if (!ownerSession) {
        router.replace(`/login?returnTo=${encodeURIComponent("/?register=1")}`);
        return;
      }
      setRegistrationOpen(true);
      params.delete("register");
      const nextQuery = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ownerSession, ownerSessionChecked, router]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    storeThemePreference(next);
  }

  function startRegistration() {
    if (!ownerSessionChecked) {
      showToast("로그인 상태를 확인하고 있습니다. 잠시 후 다시 눌러 주세요.");
      return;
    }
    if (!ownerSession) {
      router.push(`/login?returnTo=${encodeURIComponent("/?register=1")}`);
      return;
    }
    setRegistrationOpen(true);
    setMobileOpen(false);
  }

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(message);
    } catch {
      showToast("길게 눌러 복사해 주세요.");
    }
  }

  function toggleFavorite(id: string) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function resetFilters() {
    setEdition("ALL");
    setCategory("전체");
    setQuery("");
    setOnlineOnly(false);
    setSort(directoryView === "new" ? "newest" : "recommended");
  }

  async function openServerClaim(server: Server) {
    const session = await fetch("/api/auth/session", { cache: "no-store" });
    if (!session.ok) {
      router.push(`/login?returnTo=${encodeURIComponent(`/?claim=${server.id}`)}`);
      return;
    }
    setSelected(null); setClaimTarget(server); setClaimResult(null); setClaimMessage("");
  }

  async function createClaim(method: "motd" | "dns") {
    if (!claimTarget) return;
    setClaimBusy(true); setClaimMessage("");
    try {
      const response = await fetch("/api/ownership/claims", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: claimTarget.id, method }),
      });
      const body = await response.json() as ClaimStart & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "서버 주장 요청에 실패했습니다.");
      setClaimResult(body); setClaimMessage("인증값을 적용한 뒤 기술 인증을 실행해 주세요.");
    } catch (error) { setClaimMessage(error instanceof Error ? error.message : "서버 주장 요청 실패"); }
    finally { setClaimBusy(false); }
  }

  async function verifyClaim() {
    if (!claimResult) return;
    setClaimBusy(true); setClaimMessage("");
    try {
      const response = await fetch(`/api/ownership/claims/${claimResult.claim.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", verificationToken: claimResult.verificationToken }),
      });
      const body = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(body.error ?? "기술 인증에 실패했습니다.");
      setClaimResult((current) => current ? { ...current, claim: { ...current.claim, status: body.status ?? "pending_review" } } : current);
      setClaimMessage("기술 인증을 통과했습니다. Minecraft.kr 총관리자 승인 후 소유권이 이전됩니다.");
    } catch (error) { setClaimMessage(error instanceof Error ? error.message : "기술 인증 실패"); }
    finally { setClaimBusy(false); }
  }

  const sponsored = filtered.filter((server) => server.sponsored);
  const organic = filtered.filter((server) => !server.sponsored);
  const onlineCount = servers.filter((server) => server.online).length;
  const totalPlayers = servers.reduce((sum, server) => sum + server.players, 0);

  return (
    <div className="site-shell">
      <a className="skip-link" href="#server-list">서버 목록으로 건너뛰기</a>

      <PublicSiteHeader
        active={directoryView}
        ownerSession={ownerSession}
        ownerSessionChecked={ownerSessionChecked}
        theme={theme}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        onToggleTheme={toggleTheme}
        onRegister={startRegistration}
        onDirectoryViewChange={changeDirectoryView}
      />

      <main id="top">
        <section className="hero">
          <div className="container hero-layout">
            <div className="hero-copy">
              <span className="eyebrow">KOREA SERVER INDEX</span>
              <h1><em>한국 마인크래프트</em><br />서버리스트</h1>
              <p>추천 순위, 현재 접속자, 버전과 상태를 한 목록에서 확인하고 바로 접속 주소를 복사하세요.</p>
            </div>
            <div className="hero-search-wrap">
              <label htmlFor="hero-search">서버 검색</label>
              <div className="hero-search">
                <Search size={20} aria-hidden="true" />
                <input id="hero-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="서버 이름, 주소, 장르" />
                <a href="#server-list">검색</a>
              </div>
              <div className="index-status"><span><i /> 온라인 서버 <b>{formatPlayers(onlineCount)}</b></span><span>현재 접속자 <b>{formatPlayers(totalPlayers)}</b></span><span>{directoryConnection === "live" ? "실시간 LIVE" : "자동 갱신"} <b>{directoryUpdatedAt ? relativeTime(directoryUpdatedAt) : "불러오는 중"}</b></span></div>
            </div>
          </div>
        </section>

        <section className="directory" id="server-list">
          <div className="container">
            {directoryView === "small" ? <div className="small-directory-hero">
              <div className="small-directory-copy"><span>SMALL COMMUNITY INDEX</span><h2>작지만 오래 머물고 싶은 서버</h2><p>최근 7일 실측 평균 동시 접속자가 20명 미만인 서버만 모았습니다. 현재 온라인·신뢰 점수·추천 기록을 함께 비교해 취향에 맞는 작은 커뮤니티를 찾아보세요.</p></div>
              <div className="small-directory-stats" aria-label="소규모 서버 현황">
                <div><Users size={18} aria-hidden="true" /><span>추천 대상<b>{formatPlayers(smallServerPool.length)}개</b></span></div>
                <div><Activity size={18} aria-hidden="true" /><span>현재 온라인<b>{formatPlayers(smallOnlineCount)}개</b></span></div>
                <div><Signal size={18} aria-hidden="true" /><span>브리지 연결<b>{formatPlayers(smallBridgeCount)}개</b></span></div>
              </div>
              <div className="small-directory-rule"><ShieldCheck size={15} aria-hidden="true" /><span><b>선정 기준</b> 7일 평균 0명 이상 20명 미만 · 상태 이력 없는 서버 제외 · 30초마다 자동 갱신</span></div>
            </div> : directoryView === "new" ? <div className="small-directory-hero new-directory-hero">
              <div className="small-directory-copy"><span>NEW SERVER ARRIVALS</span><h2>새롭게 등록된 서버</h2><p>등록일 기준 최근 7일 이내 공개된 서버만 모았습니다. 새로운 커뮤니티를 먼저 발견하고 현재 상태와 신뢰 점수를 함께 확인해 보세요.</p></div>
              <div className="small-directory-stats" aria-label="신규 서버 현황">
                <div><Clock3 size={18} aria-hidden="true" /><span>7일 내 등록<b>{formatPlayers(newServerPool.length)}개</b></span></div>
                <div><Activity size={18} aria-hidden="true" /><span>현재 온라인<b>{formatPlayers(newOnlineCount)}개</b></span></div>
                <div><Signal size={18} aria-hidden="true" /><span>브리지 연결<b>{formatPlayers(newBridgeCount)}개</b></span></div>
              </div>
              <div className="small-directory-rule"><ShieldCheck size={15} aria-hidden="true" /><span><b>선정 기준</b> 서버 최초 등록 시각부터 7일 이내 · 공개 인증 완료 서버만 표시 · 30초마다 자동 갱신</span></div>
            </div> : <div className="section-heading"><div><span>SERVER DIRECTORY</span><h2>실시간 서버 리스트</h2></div></div>}
            <div className="filter-bar" id="filters" aria-label="서버 필터">
              <div className="edition-tabs" aria-label="에디션">
                {(["ALL", "JE", "BE"] as Edition[]).map((item) => (
                  <button key={item} type="button" className={edition === item ? "active" : ""} aria-pressed={edition === item} onClick={() => setEdition(item)}>
                    {item === "ALL" ? "전체" : item === "JE" ? "Java" : "Bedrock"}
                  </button>
                ))}
              </div>
              <DirectoryFilterSelect label="카테고리" value={effectiveCategory} options={categoryOptions} onValueChange={setCategory} />
              <DirectoryFilterSelect label="정렬" value={sort} options={[{ value: "recommended", label: "추천 순" }, { value: "newest", label: "신규 등록 순" }, { value: "players", label: "접속자 순" }, { value: "latency", label: "응답속도 순" }, { value: "trust", label: "신뢰도 순" }]} onValueChange={(value) => setSort(value as SortKey)} />
              <div className="online-filter"><span>온라인만</span><Switch.Root className="switch-control" checked={onlineOnly} onCheckedChange={setOnlineOnly} aria-label="온라인 서버만 보기"><Switch.Thumb className="switch-thumb" /></Switch.Root></div>
              <button className="reset-button" type="button" onClick={resetFilters}>초기화</button>
            </div>

            {directoryView === "all" ? <div className="list-head"><span><b>{filtered.length}</b>개 서버</span><div><span>반응형 홍보 배너</span><span>버전</span><span>접속자</span><span>추천</span></div></div> : <div className="list-head featured-list-head"><span><b>{filtered.length}</b>개 {directoryView === "new" ? "신규 서버" : "소규모 서버"}</span><div><span>{directoryView === "new" ? "최근 7일 등록 · 최신순" : "7일 평균 동접 20명 미만 · 추천순"}</span></div></div>}

            <div className={directoryView === "all" ? "directory-results" : "directory-results featured-directory-results"}>
              {directoryView === "small" ? (
                <div className="small-server-group featured-server-group">
                  <div className="group-label"><b>SMALL SERVER RECOMMENDATION</b><span>온라인·신뢰도 우선 추천 · 평균 동접 20명 미만</span></div>
                  {directoryLoading ? <div className="empty-state"><b>소규모 서버 통계를 계산하는 중</b><p>최근 7일 수집 기록을 확인하고 있습니다.</p></div> : filtered.length > 0 ? filtered.map((server, index) => <SmallServerRow key={server.id} server={server} rank={index + 1} favorite={favorites.includes(server.id)} onFavorite={() => toggleFavorite(server.id)} onCopy={() => copyText(server.address, `${server.address} 주소를 복사했습니다.`)} onOpen={() => void openServer(server)} />) : <div className="empty-state"><b>{smallServerPool.length === 0 ? "선정 기준을 충족한 서버가 없습니다" : "검색 결과 없음"}</b><p>{smallServerPool.length === 0 ? "상태 이력이 수집되고 7일 평균이 20명 미만이면 자동으로 추가됩니다." : "검색어 또는 필터를 변경해 보세요."}</p><button type="button" onClick={resetFilters}>필터 초기화</button></div>}
                </div>
              ) : directoryView === "new" ? (
                <div className="server-group new-server-group featured-server-group">
                  <div className="group-label"><b>NEW SERVER ARRIVALS · 7 DAYS</b><span>최초 등록일 기준 최신순 · 공개 인증 서버만 표시</span></div>
                  {directoryLoading ? <div className="empty-state"><b>신규 서버를 확인하는 중</b><p>최근 7일 등록 기록을 불러오고 있습니다.</p></div> : filtered.length > 0 ? filtered.map((server, index) => <ServerRow key={server.id} server={server} rank={index + 1} favorite={favorites.includes(server.id)} onFavorite={() => toggleFavorite(server.id)} onCopy={() => copyText(server.address, `${server.address} 주소를 복사했습니다.`)} onOpen={() => void openServer(server)} />) : <div className="empty-state"><b>{newServerPool.length === 0 ? "최근 7일 이내 등록된 서버가 없습니다" : "검색 결과 없음"}</b><p>{newServerPool.length === 0 ? "새 서버가 등록되고 공개 인증을 마치면 자동으로 이 목록에 추가됩니다." : "검색어 또는 필터를 변경해 보세요."}</p><button type="button" onClick={resetFilters}>필터 초기화</button></div>}
                </div>
              ) : (
                <>
                  {sponsored.length > 0 && <div className="server-group sponsored-group"><div className="group-label"><b>SPONSORED · PREMIUM SHOWCASE</b><span>상단 위치·광고 배지로 강조 · 목록 배너 규격은 일반 서버와 동일</span></div>{sponsored.map((server) => <ServerRow key={server.id} server={server} favorite={favorites.includes(server.id)} onFavorite={() => toggleFavorite(server.id)} onCopy={() => copyText(server.address, `${server.address} 주소를 복사했습니다.`)} onOpen={() => void openServer(server)} />)}</div>}
                  {directoryLoading ? <div className="empty-state"><b>실시간 서버 목록을 불러오는 중</b><p>등록·인증된 서버만 표시합니다.</p></div> : organic.length > 0 ? <div className="server-group"><div className="group-label"><b>LIVE RANKING</b></div>{organic.map((server, index) => <ServerRow key={server.id} server={server} rank={index + 1} favorite={favorites.includes(server.id)} onFavorite={() => toggleFavorite(server.id)} onCopy={() => copyText(server.address, `${server.address} 주소를 복사했습니다.`)} onOpen={() => void openServer(server)} />)}</div> : <div className="empty-state"><b>{servers.length === 0 ? "공개 인증된 서버가 없습니다" : "검색 결과 없음"}</b><p>{servers.length === 0 ? "운영자센터에서 서버 소유권과 브리지 연결을 완료하면 즉시 표시됩니다." : "검색어 또는 필터를 변경해 보세요."}</p><button type="button" onClick={resetFilters}>전체 서버 보기</button></div>}
                </>
              )}
            </div>
          </div>
        </section>

        <section className="operator-strip" id="operator"><div className="container operator-inner"><div><span>FOR SERVER OWNERS</span><h2>운영자 센터</h2></div><p>MOTD 소유권 인증, 실시간 상태, 추천 통계와 운영진 소개를 관리합니다.</p><button type="button" onClick={startRegistration}>서버 등록 <ArrowUpRight size={16} aria-hidden="true" /></button></div></section>
      </main>

      <footer className="site-footer"><div className="container footer-inner"><a className="brand" href="#top"><span className="brand-mark">M</span><span>Minecraft.kr</span></a><nav><a href="#server-list">서버 목록</a><a href="/operator">운영자 센터</a><a href="/terms">이용약관</a><a href="/privacy">개인정보 처리방침</a><a href="mailto:zehelper@gmail.com">문의</a></nav><small>© 2026 Minecraft.kr · Mojang/Microsoft와 제휴되지 않은 독립 서비스입니다.</small></div></footer>

      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        {selected && <ServerDetail server={selected} onCopy={(value, message) => copyText(value, message)} onMessage={showToast} onRefresh={() => refreshSelected(selected.id)} onClaim={() => void openServerClaim(selected)} />}
      </Dialog.Root>

      <Dialog.Root open={Boolean(claimTarget)} onOpenChange={(open) => { if (!open) { setClaimTarget(null); setClaimResult(null); setClaimMessage(""); } }}>
        {claimTarget && <ClaimServerDialog server={claimTarget} result={claimResult} busy={claimBusy} message={claimMessage} onCreate={createClaim} onVerify={verifyClaim} />}
      </Dialog.Root>

      <ServerRegistrationDialog open={registrationOpen} onOpenChange={setRegistrationOpen} onMessage={showToast} onCreated={(serverId) => { window.setTimeout(() => router.push(`/operator?created=${serverId}`), 450); }} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function PromoBanner({ server, large = false }: { server: Server; large?: boolean }) {
  const hasAsset = large ? server.hasDetailBanner : server.hasListBanner;
  const desktopKind = large ? "desktopDetail" : "desktopList";
  const mobileKind = large ? "mobileDetail" : "desktopList";
  const fallbackKind = large ? mobileKind : "mobileList";
  const desktopSourceKind = server.bannerContentTypes[desktopKind] ? desktopKind : server.bannerContentTypes[fallbackKind] ? fallbackKind : mobileKind;
  const mobileSourceKind = server.bannerContentTypes[mobileKind] ? mobileKind : server.bannerContentTypes[desktopKind] ? desktopKind : fallbackKind;
  const desktopType = server.bannerContentTypes[desktopSourceKind];
  const mobileType = server.bannerContentTypes[mobileSourceKind];
  const defaultTransform = { focusX: 50, focusY: 50, zoom: 100 };
  const desktopTransform = server.bannerTransforms?.[desktopSourceKind] ?? defaultTransform;
  const mobileTransform = server.bannerTransforms?.[mobileSourceKind] ?? defaultTransform;
  const desktopUrl = `/api/servers/${server.id}/assets/${desktopSourceKind}`;
  const mobileUrl = `/api/servers/${server.id}/assets/${mobileSourceKind}`;
  const generatedStyle = hasAsset ? {
    "--desktop-banner": `url(${desktopUrl})`,
    "--mobile-banner": `url(${mobileUrl})`,
  } as CSSProperties : undefined;
  return <div className={`${large ? "detail-hero-banner" : "server-promo-banner"} theme-${themeFromId(server.id)}${hasAsset ? " generated-asset-banner" : ""}`} style={generatedStyle} aria-label={`${server.name} 반응형 홍보 배너`}>
    {desktopType === "image/gif" && <img className="banner-gif desktop-banner-gif" src={desktopUrl} style={motionTransformStyle(desktopTransform)} alt="" aria-hidden="true" />}
    {mobileType === "image/gif" && <img className="banner-gif mobile-banner-gif" src={mobileUrl} style={motionTransformStyle(mobileTransform)} alt="" aria-hidden="true" />}
    {desktopType === "video/webm" && <video className="banner-webm desktop-banner-webm" style={motionTransformStyle(desktopTransform)} autoPlay loop muted playsInline preload="metadata" aria-hidden="true"><source src={desktopUrl} type="video/webm" /></video>}
    {mobileType === "video/webm" && <video className="banner-webm mobile-banner-webm" style={motionTransformStyle(mobileTransform)} autoPlay loop muted playsInline preload="metadata" aria-hidden="true"><source src={mobileUrl} type="video/webm" /></video>}
  </div>;
}

function ServerIcon({ server, detail = false }: { server: Server; detail?: boolean }) {
  const theme = themeFromId(server.id);
  const className = `server-mark${detail ? " detail-mark" : ""} theme-${theme}${server.hasIcon ? " generated-server-icon" : ""}`;
  if (!server.hasIcon) return <div className={className}>{initials(server.name)}</div>;
  const source = `/api/servers/${server.id}/assets/icon`;
  const animatedStyle = motionTransformStyle(server.iconTransform ?? { focusX: 50, focusY: 50, zoom: 100 });
  return <div className={className} aria-label={`${server.name} 서버 아이콘`}>
    {server.iconContentType === "video/webm"
      ? <video src={source} style={animatedStyle} autoPlay loop muted playsInline preload="metadata" aria-hidden="true" />
      : <img src={source} style={server.iconContentType === "image/gif" ? animatedStyle : undefined} alt="" aria-hidden="true" />}
  </div>;
}

function motionTransformStyle(transform: { focusX: number; focusY: number; zoom: number }): CSSProperties {
  return {
    objectPosition: `${transform.focusX}% ${transform.focusY}%`,
    transform: `scale(${transform.zoom / 100})`,
    transformOrigin: `${transform.focusX}% ${transform.focusY}%`,
  };
}

function DirectoryFilterSelect({ label, value, options, onValueChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  return <div className="select-filter directory-select"><span>{label}</span><Select.Root value={value} onValueChange={onValueChange}>
    <Select.Trigger className="directory-select-trigger" aria-label={label}><Select.Value /><Select.Icon><ChevronDown size={14} /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="directory-select-content" position="popper" sideOffset={6} align="end">
      <Select.ScrollUpButton className="directory-select-scroll"><ChevronUp size={13} /></Select.ScrollUpButton>
      <Select.Viewport className="directory-select-viewport">{options.map((option) => <Select.Item className="directory-select-item" key={option.value} value={option.value}><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator className="directory-select-indicator"><Check size={13} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport>
      <Select.ScrollDownButton className="directory-select-scroll"><ChevronDown size={13} /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root></div>;
}

function ClaimServerDialog({ server, result, busy, message, onCreate, onVerify }: {
  server: Server; result: ClaimStart | null; busy: boolean; message: string;
  onCreate: (method: "motd" | "dns") => Promise<void>; onVerify: () => Promise<void>;
}) {
  const completed = result?.claim.status === "pending_review";
  return <Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="claim-modal" aria-modal="true" aria-labelledby="claim-title">
    <Dialog.Close asChild><button className="modal-close" type="button" aria-label="서버 주장 닫기"><X size={18} /></button></Dialog.Close>
    <div className="claim-modal-head"><span>SERVER OWNERSHIP CLAIM</span><Dialog.Title asChild><h2 id="claim-title">{server.name} 서버 주장하기</h2></Dialog.Title><Dialog.Description asChild><p>서버에 실제로 접근할 수 있는 운영자임을 기술적으로 인증합니다.</p></Dialog.Description></div>
    {!result ? <div className="claim-methods"><button disabled={busy} onClick={() => void onCreate("motd")}><Signal size={20} /><span><b>MOTD 인증</b><small>서버 MOTD에 일회용 문자열을 추가합니다.</small></span></button><button disabled={busy} onClick={() => void onCreate("dns")}><ShieldCheck size={20} /><span><b>DNS TXT 인증</b><small>서버 도메인의 DNS 레코드로 통제권을 확인합니다.</small></span></button></div> : completed ? <div className="claim-review-ready"><CheckCircle2 size={28} /><h3>기술 인증 완료</h3><p>Minecraft.kr 총관리자가 기존 운영자 활동과 인증 기록을 확인한 뒤 승인 또는 거절합니다.</p><a href="/operator">운영자센터에서 진행 상태 보기</a></div> : <div className="claim-challenge">
      <div className="claim-step"><b>01</b><span>{result.challenge.label}</span></div>
      {result.challenge.method === "motd" ? <code>{result.challenge.marker}</code> : <div className="claim-dns-values"><label>호스트<code>{result.challenge.host}</code></label><label>유형<code>{result.challenge.recordType}</code></label><label>값<code>{result.challenge.value}</code></label></div>}
      <div className="claim-step"><b>02</b><span>적용 후 아래 버튼으로 실제 서버를 확인합니다.</span></div>
      <button className="claim-verify-button" disabled={busy} onClick={() => void onVerify()}>{busy ? "확인 중…" : result.challenge.method === "motd" ? "실제 서버 MOTD 확인" : "DNS TXT 레코드 확인"}</button>
    </div>}
    {message && <div className="claim-message" role="status">{message}</div>}
    <div className="claim-policy"><ShieldCheck size={15} /><p>인증만으로 즉시 이전되지 않습니다. 기존 소유자 통보, 총관리자 심사, 진행 중인 경매·광고 확인을 모두 통과해야 합니다.</p></div>
  </Dialog.Content></Dialog.Portal>;
}

function TrendChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as TrendChartPoint | undefined;
  if (!point) return null;
  const source = point.source === "bridge" ? "브리지 실측" : point.source === "mixed" ? "브리지 + 공개 핑" : "공개 핑";
  return <div className="trend-tooltip" role="status">
    <div><span>{point.date}{point.isCurrent ? " · 최신" : point.isPeak ? " · 최고" : point.isLow ? " · 최저" : ""}</span><b>{formatPlayers(point.players)}명</b></div>
    <div className={point.delta !== null && point.delta < 0 ? "trend-delta down" : "trend-delta"}><span>전일 대비</span><strong>{point.delta === null ? "수집 시작" : `${point.delta >= 0 ? "+" : ""}${formatPlayers(point.delta)}명`}</strong></div>
    <small>정원 대비 {point.capacityRate}%</small><em>{source}</em>
  </div>;
}

function PlayerTrendChart({ points, yAxisMax, averagePlayers, serverId }: { points: TrendChartPoint[]; yAxisMax: number; averagePlayers: number; serverId: string }) {
  const gradientId = `player-trend-${serverId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const currentPoint = points.at(-1);
  const peakPoint = points.reduce<TrendChartPoint | undefined>((peak, point) => !peak || point.players > peak.players ? point : peak, undefined);
  return <div className="trend-chart-frame" aria-label={`최근 14일 접속자 5분 기록 ${points.length}개`}>
    <AreaChart data={points} width="100%" height="100%" responsive accessibilityLayer margin={{ top: 22, right: 16, bottom: 2, left: 0 }}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent-bright)" stopOpacity={0.38} /><stop offset="70%" stopColor="var(--accent)" stopOpacity={0.1} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
      <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickCount={7} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 7, fontFamily: "ui-monospace, monospace" }} tickFormatter={(value: number) => formatTrendAxis(value)} tickMargin={10} minTickGap={22} />
      <YAxis width={42} domain={[0, yAxisMax]} tickCount={5} allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 7, fontFamily: "ui-monospace, monospace" }} tickFormatter={(value: number) => formatPlayers(value)} />
      <Tooltip content={<TrendChartTooltip />} cursor={{ stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "3 3" }} animationDuration={120} wrapperStyle={{ outline: "none" }} />
      <ReferenceLine y={averagePlayers} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: `AVG ${formatPlayers(averagePlayers)}`, position: "insideTopRight", fill: "var(--muted)", fontSize: 7 }} />
      <Area type="monotoneX" dataKey="players" name="접속자" stroke="var(--accent-bright)" strokeWidth={2.5} fill={`url(#${gradientId})`} dot={points.length <= 96 ? { r: 2.5, fill: "var(--surface)", stroke: "var(--accent)", strokeWidth: 2 } : false} activeDot={{ r: 5, fill: "var(--surface)", stroke: "var(--accent-bright)", strokeWidth: 2 }} animationDuration={520} />
      {peakPoint && peakPoint.timestamp !== currentPoint?.timestamp && <ReferenceDot x={peakPoint.timestamp} y={peakPoint.players} r={4} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />}
      {currentPoint && <ReferenceDot x={currentPoint.timestamp} y={currentPoint.players} r={4.5} fill="var(--accent-bright)" stroke="var(--surface)" strokeWidth={2} />}
    </AreaChart>
  </div>;
}

function ServerDetail({ server, onCopy, onMessage, onRefresh, onClaim }: {
  server: Server;
  onCopy: (value: string, message: string) => void;
  onMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
  onClaim: () => void;
}) {
  const [voteOpen, setVoteOpen] = useState(false);
  const [voteNickname, setVoteNickname] = useState("");
  const [voting, setVoting] = useState(false);
  const embedMediaType = server.bannerContentTypes.desktopList ?? server.bannerContentTypes.mobileList;
  const safeEmbedName = escapeEmbedAttribute(server.name);
  const ticketEmbed = `<iframe src="https://minecraft.kr/embed/server/${server.id}" title="${safeEmbedName} Minecraft.kr 서버 탑승권" width="760" height="190" loading="lazy" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;max-width:760px;height:190px;border:0;overflow:hidden;display:block"></iframe>`;
  const legacyEmbed = embedMediaType === "video/webm"
    ? `<a href="https://minecraft.kr/?server=${server.id}"><video src="https://minecraft.kr/api/servers/${server.id}/assets/desktopList" width="468" height="60" autoplay loop muted playsinline aria-label="${safeEmbedName} 서버"></video></a>`
    : `<a href="https://minecraft.kr/?server=${server.id}"><img src="https://minecraft.kr/api/servers/${server.id}/assets/desktopList" width="468" height="60" alt="${safeEmbedName} 서버"></a>`;
  const serverCapacity = Math.max(server.capacity, ...server.trend.map((point) => point.maxPlayers), 1);
  const chartPlayers = server.trend.map((point) => point.players);
  const averagePlayers = chartPlayers.length ? Math.round(chartPlayers.reduce((sum, players) => sum + players, 0) / chartPlayers.length) : 0;
  const peakPlayers = chartPlayers.length ? Math.max(...chartPlayers) : 0;
  const lowPlayers = chartPlayers.length ? Math.min(...chartPlayers) : 0;
  const chartYAxisMax = trendChartUpperBound(peakPlayers);
  const chartPoints: TrendChartPoint[] = server.trend.map((point, index) => ({
    timestamp: point.bucketAt * 1000,
    date: formatTrendMoment(point.bucketAt),
    players: point.players,
    capacityRate: Math.round((point.players / serverCapacity) * 100),
    source: point.source,
    delta: index === 0 ? null : point.players - server.trend[index - 1].players,
    isPeak: point.players === peakPlayers,
    isLow: point.players === lowPlayers,
    isCurrent: index === server.trend.length - 1,
  }));
  const latestTrendAt = server.trend.at(-1)?.bucketAt ?? null;
  const averageRate = Math.round((averagePlayers / serverCapacity) * 100);
  async function submitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVoting(true);
    try {
      const response = await fetch(`/api/servers/${server.id}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: voteNickname }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "추천을 등록하지 못했습니다.");
      setVoteNickname("");
      setVoteOpen(false);
      await onRefresh();
      onMessage(`${server.name} 추천이 실시간 집계되었습니다.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "추천 등록 실패");
    } finally {
      setVoting(false);
    }
  }

  return <Dialog.Portal>
    <Dialog.Overlay className="modal-backdrop" />
    <Dialog.Content className="detail-modal" aria-modal="true" aria-labelledby="detail-title">
      <Dialog.Close asChild><button className="modal-close" type="button" aria-label="상세 닫기"><X size={19} /></button></Dialog.Close>
      <PromoBanner server={server} large />
      <div className="detail-shell">
        <div className="detail-summary">
          <div className="detail-identity"><ServerIcon server={server} detail /><div><div className="detail-kicker"><span>{server.edition} SERVER</span><span>{server.statusSource === "bridge" ? "브리지 실시간 연결" : server.statusSource === "ping" ? "공개 핑 연결" : "현재 오프라인"}</span>{server.verified && <span><BadgeCheck size={12} /> 운영자 인증</span>}</div><Dialog.Title asChild><h2 id="detail-title">{server.name}</h2></Dialog.Title><Dialog.Description asChild><p>{server.summary}</p></Dialog.Description><div className="detail-tags">{server.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div></div>
          <div className="detail-quick-actions"><button type="button" className="address-hero" title={`${server.address} 복사`} onClick={() => onCopy(server.address, `${server.address} 주소를 복사했습니다.`)}><span><Signal size={14} /> {server.address}</span><b><Copy size={14} /> 복사</b></button><button type="button" className="vote-button" onClick={() => setVoteOpen(true)}><Trophy size={16} /> 오늘 추천하기</button>{server.discordEnabled && server.discordUrl && <a className="secondary-action" href={server.discordUrl} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Discord</a>}{server.websiteEnabled && server.websiteUrl && <a className="secondary-action" href={server.websiteUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> 웹사이트</a>}{server.kakaoEnabled && server.kakaoUrl && <a className="secondary-action" href={server.kakaoUrl} target="_blank" rel="noreferrer"><MessageCircle size={15} /> 카카오톡</a>}</div>
          <div className="detail-status-strip" aria-label="서버 실시간 연결 상태"><div className={`detail-online-status ${server.online ? "online" : "offline"}`}><i /><div><small>SERVER STATUS</small><b>{server.online ? "현재 온라인" : "현재 오프라인"}</b><span>{server.online ? `${formatPlayers(server.players)}명 접속 · ${server.latency}ms 응답` : "최근 공개 응답을 확인하지 못했습니다."}</span></div></div><div className={`detail-bridge-status ${server.bridgeStatus}`}><Activity size={17} /><div><small>BRIDGE STATUS</small><b>{server.bridgeStatus === "live" ? "브리지 실시간 연결" : server.bridgeStatus === "stale" ? "브리지 신호 지연" : "브리지 미연결 서버"}</b><span>{server.bridgeStatus === "live" ? "운영 서버가 접속자 데이터를 직접 전송합니다." : server.bridgeStatus === "stale" ? "마지막 플러그인 신호가 오래되었습니다." : "온라인 여부는 Minecraft 공개 핑으로 확인합니다."}</span></div></div></div>
        </div>

        <div className="detail-stats">
          <div><Users size={16} /><span>현재 접속자</span><strong>{formatPlayers(server.players)} <small>/ {server.capacity > 0 ? formatPlayers(server.capacity) : "-"}</small></strong></div>
          <div><Trophy size={16} /><span>누적 추천</span><strong>{formatPlayers(server.votes)}</strong></div>
          <div><Signal size={16} /><span>지원 버전</span><strong>{server.version}</strong></div>
          <div><Activity size={16} /><span>30일 가동률</span><strong>{server.uptime}%</strong></div>
          <div><ShieldCheck size={16} /><span>신뢰 점수</span><strong>{server.trust} <small>/ 100 · {server.trustGrade}</small></strong></div>
        </div>

        <nav className="detail-nav" aria-label="서버 상세 섹션"><a href="#server-intro">서버 소개</a>{server.staffIntroEnabled && server.staff.length > 0 && <a href="#server-staff">운영진</a>}<a href="#server-stats">실시간 통계</a><a href="#recent-votes">최근 추천</a><a href="#connect-guide">접속 안내</a><a href="#status-banner">상태 배너</a></nav>

        <div className="detail-layout">
          <div className="detail-main">
            <section className="detail-section" id="server-intro"><div className="section-title"><span>01</span><div><h3>서버 소개</h3><p>운영자가 직접 편집한 서버 상세 소개와 홍보 포스터</p></div></div><div className="intro-copy"><h4>{server.summary}</h4><ServerDescription document={server.descriptionDocument} serverId={server.id} fallback={server.description} /></div></section>

            {server.staffIntroEnabled && server.staff.length > 0 && <section className="detail-section" id="server-staff"><div className="section-title"><span>TEAM</span><div><h3>서버 운영진</h3><p>서버를 함께 운영하는 담당자를 소개합니다.</p></div></div><div className="server-staff-grid">{server.staff.map((member) => <article className="server-staff-card" key={member.id}><MinecraftHead nickname={member.nickname} minecraftUuid={member.minecraftUuid} size={56} /><div><span>{member.role}</span><b>{member.nickname}</b><p>{member.introduction}</p>{member.discordEnabled && member.discordUrl && <StaffDiscordContact value={member.discordUrl} nickname={member.nickname} onCopy={onCopy} />}</div></article>)}</div></section>}

            <section className="detail-section chart-section" id="server-stats">
              <div className="section-title chart-section-title"><span>02</span><div><h3>14일 접속자 추세</h3><p>5분 원본 기록을 그대로 표시하며, 브리지 연결 시 운영 서버가 보낸 값을 우선 사용합니다.</p></div><div className="chart-current"><span><i /> LIVE</span><strong>{formatPlayers(server.players)}명</strong><small>{latestTrendAt ? `최근 기록 ${relativeTime(latestTrendAt)}` : "5분 기록 대기 중"}</small></div></div>
              {chartPoints.length > 0 ? <><div className="chart-insights" aria-label="14일 접속자 요약"><div><span>14일 평균</span><b>{formatPlayers(averagePlayers)}명</b><small>정원 대비 {averageRate}%</small></div><div><span>최고 접속</span><b>{formatPlayers(peakPlayers)}명</b><small>{chartPoints.find((point) => point.isPeak)?.date}</small></div><div><span>최저 접속</span><b>{formatPlayers(lowPlayers)}명</b><small>{chartPoints.find((point) => point.isLow)?.date}</small></div></div>
              <div className="chart-legend"><span><i className="legend-current" />5분 접속자 추세</span><span><i className="legend-average" />14일 평균</span><span><i className="legend-peak" />현재 지점</span><small>5분 원본 {formatPlayers(chartPoints.length)}개 · 30초마다 새 기록 확인</small></div>
              <PlayerTrendChart points={chartPoints} yAxisMax={chartYAxisMax} averagePlayers={averagePlayers} serverId={server.id} /></> : <p className="live-empty">홈페이지 공개 핑 수집이 시작되었습니다. 첫 5분 기록이 생성되면 차트가 표시됩니다.</p>}
              <div className="chart-summary"><span><b>{server.growth >= 0 ? "+" : ""}{server.growth}%</b> 지난주 대비<small>최근 7일 성장률</small></span><span><b>{server.latency}ms</b> 현재 응답<small>{server.statusSource === "bridge" ? "브리지 측정" : "홈페이지 공개 핑"}</small></span><span><b>{server.uptime}%</b> 30일 가동률<small>웹 모니터·브리지 5분 기록</small></span></div>
            </section>

            <section className="detail-section" id="connect-guide"><div className="section-title"><span>03</span><div><h3>접속 안내</h3><p>에디션에 맞는 주소를 복사해 멀티플레이 서버에 추가하세요.</p></div></div><div className="connect-grid"><div><span>JAVA EDITION</span><b>{server.edition.includes("JE") ? server.address : "현재 지원하지 않음"}</b><small>버전 {server.version}</small></div><div><span>BEDROCK EDITION</span><b>{server.edition.includes("BE") ? `${server.host} : ${server.port}` : "현재 지원하지 않음"}</b><small>Windows · Android · iOS</small></div></div><details><summary>추천은 어떻게 집계되나요?</summary><p>Minecraft Java 닉네임 기준으로 서버마다 하루 한 번 추천할 수 있으며, 중복 요청은 자동으로 차단됩니다.</p></details><details><summary>접속할 수 없을 때 확인할 항목</summary><p>지원 버전과 서버 주소를 확인한 뒤, 공식 런처에서 멀티플레이 연결을 다시 시도해 주세요.</p></details></section>

            <section className="detail-section ticket-embed-section" id="status-banner"><div className="section-title"><span>04</span><div><h3>Minecraft.kr 서버 탑승권</h3><p>외부 카페·블로그에 붙이면 실시간 정보가 표시되는 우리만의 항공권형 서버 카드입니다.</p></div></div><div className="ticket-embed-head"><div><Ticket size={18} /><span><b>SERVER BOARDING PASS</b><small>760×190 · 반응형 · 30초 자동 갱신</small></span></div><em className={server.online ? "online" : "offline"}>{server.online ? "NOW BOARDING" : "GATE CLOSED"}</em></div><div className="ticket-iframe-shell"><iframe src={`/embed/server/${server.id}`} title={`${server.name} Minecraft.kr 서버 탑승권 미리보기`} width="760" height="190" loading="lazy" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" /></div><div className="ticket-code-box"><div><Code2 size={17} /><span><b>외부 사이트용 HTML</b><small>HTML 입력이 가능한 게시판·블로그에 한 줄 그대로 붙여 넣으세요.</small></span></div><code>{ticketEmbed}</code><button type="button" onClick={() => onCopy(ticketEmbed, "Minecraft.kr 서버 탑승권 코드를 복사했습니다.")}><Copy size={14} /> 탑승권 코드 복사</button></div><details className="legacy-banner-code"><summary>468×60 기존 이미지·움직이는 배너 코드</summary><div><PromoBanner server={server} /><div className="embed-code"><Code2 size={16} /><code>{legacyEmbed}</code><button type="button" onClick={() => onCopy(legacyEmbed, "468×60 호환 배너 코드를 복사했습니다.")}><Copy size={14} /> 호환 코드 복사</button></div></div></details></section>
          </div>

          <aside className="detail-aside">
            <section className="aside-panel" id="recent-votes"><div className="aside-title"><div><span>LIVE</span><h3>최근 추천</h3></div><small>실시간</small></div>{server.recentVotes.length > 0 ? <div className="vote-activity">{server.recentVotes.map((vote, index) => <div key={vote.id}><MinecraftHead nickname={vote.nickname} minecraftUuid={vote.minecraftUuid} size={34} /><div><b>{vote.nickname}</b><small><Clock3 size={10} /> {relativeTime(vote.createdAt)}</small></div><span className="reward sent">추천 완료</span>{index === 0 && <i className="latest-line" />}</div>)}</div> : <p className="live-empty">아직 추천 기록이 없습니다.</p>}</section>

            <section className="aside-panel"><div className="aside-title"><div><span>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long" }).format(new Date())}</span><h3>월간 추천자 TOP 5</h3></div><Trophy size={18} /></div>{server.monthlyTop.length > 0 ? <ol className="top-voters">{server.monthlyTop.map((item, index) => <li key={item.nickname}><strong>{String(index + 1).padStart(2, "0")}</strong><span>{item.nickname}</span><b>{item.count}회</b></li>)}</ol> : <p className="live-empty">이번 달 추천 기록이 없습니다.</p>}<p className="ranking-note">닉네임 기준 1일 1회 · 중복 추천 자동 차단</p></section>

            <section className="aside-panel trust-panel"><div className="aside-title"><div><span>TRUST SCORE</span><h3>검증 상태</h3></div><ShieldCheck size={18} /></div><div className="trust-score-summary"><div className={`trust-score-gauge grade-${server.trustGrade.toLowerCase()}`} style={{ "--trust-score": `${server.trust}%` } as CSSProperties}><strong>{server.trust}</strong><span>/ 100</span></div><div><span>{server.trustGrade} GRADE</span><b>{server.trustLabel}</b><small>광고·추천수와 무관한 운영 신뢰 지표</small></div></div><div className="trust-score-progress" aria-label={`신뢰 점수 ${server.trust}점`}><i style={{ width: `${server.trust}%` }} /></div><div className="trust-factor-list">{server.trustBreakdown.map((factor) => <article key={factor.key} className={factor.state}><span className="trust-factor-icon">{factor.state === "earned" ? <CheckCircle2 size={14} /> : factor.state === "penalty" ? <X size={14} /> : <Clock3 size={14} />}</span><div><b>{factor.label}</b><small>{factor.detail}</small></div><strong>{factor.score}<small>/ {factor.maxScore}</small></strong></article>)}</div>{server.enforcementSummary.warnings === 0 && server.enforcementSummary.serious === 0 ? <div className="trust-clean-record"><CheckCircle2 size={14} /><span><b>클린 운영 기록</b><small>누적 경고·임시차단·블라인드 없음</small></span><strong>+15</strong></div> : <div className="trust-enforcement-record"><ShieldCheck size={14} /><span><b>제재 이력 반영</b><small>경고 {server.enforcementSummary.warnings}건 · 임시차단/블라인드 {server.enforcementSummary.serious}건</small></span></div>}<footer><span>마지막 신호 {server.lastSeenAt ? relativeTime(server.lastSeenAt) : "수집 전"}</span><span>실시간 자동 계산</span></footer></section>
            <section className="aside-panel server-claim-panel"><div className="aside-title"><div><span>OWNERSHIP</span><h3>이 서버 운영자이신가요?</h3></div><ArrowRightLeft size={18} /></div><p>기존 관리자가 활동하지 않거나 잘못 등록된 서버라면 실제 서버 통제권을 인증해 소유권을 주장할 수 있습니다.</p><button type="button" onClick={onClaim}>이 서버 주장하기</button><small>기존 운영자에게 알리고 총관리자 심사 후 이전됩니다.</small></section>
          </aside>
        </div>
      </div>
      <Dialog.Root open={voteOpen} onOpenChange={(open) => { if (!voting) setVoteOpen(open); }}><Dialog.Portal><Dialog.Overlay className="vote-modal-backdrop" /><Dialog.Content className="vote-modal" aria-describedby="vote-description"><Dialog.Close asChild><button type="button" className="vote-modal-close" aria-label="추천 팝업 닫기"><X size={17} /></button></Dialog.Close><div className="vote-modal-head"><span>DAILY RECOMMENDATION</span><Dialog.Title>오늘 {server.name} 추천하기</Dialog.Title><Dialog.Description id="vote-description">Minecraft Java 닉네임을 입력하면 오늘의 추천으로 즉시 집계됩니다.</Dialog.Description></div><div className={`vote-bridge-notice ${server.bridgeStatus}`}><Activity size={17} /><div><b>{server.bridgeStatus === "live" ? "브리지 연결 서버" : server.bridgeStatus === "stale" ? "브리지 신호가 지연 중입니다" : "브리지 미연결 서버입니다"}</b><span>{server.bridgeStatus === "live" ? "서버가 추천 보상 처리를 위한 실시간 데이터를 전송하고 있습니다." : "추천은 정상 집계되지만 게임 내 자동 보상 연동은 보장되지 않습니다."}</span></div></div><form className="vote-dialog-form" onSubmit={submitVote}><div className="vote-nickname-preview"><MinecraftHead nickname={voteNickname} size={52} /><label><span>Minecraft Java 닉네임</span><input autoFocus value={voteNickname} onChange={(event) => setVoteNickname(event.target.value)} pattern="[A-Za-z0-9_]{3,16}" minLength={3} maxLength={16} placeholder="Steve" aria-label="추천할 Minecraft 닉네임" required /><small>영문, 숫자, 밑줄 3–16자 · 서버별 하루 1회</small></label></div><button disabled={voting}>{voting ? "추천 집계 중…" : "닉네임으로 추천 등록"}</button></form></Dialog.Content></Dialog.Portal></Dialog.Root>
    </Dialog.Content>
  </Dialog.Portal>;
}

function ServerDescription({ document, serverId, fallback }: { document: DescriptionDocument; serverId: string; fallback: string }) {
  if (!document?.blocks?.length) return <>{fallback.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</>;
  return <div className="server-rich-description">{document.blocks.map((block) => {
    if (block.type === "divider") return <hr key={block.id} />;
    if (block.type === "poster") return <figure key={block.id} className={`server-description-poster ${block.size}`}><img src={`/api/servers/${serverId}/description-assets/${block.assetId}`} alt={block.alt} loading="lazy" />{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
    if ("items" in block) {
      const ListTag = block.type === "bulletList" ? "ul" : "ol";
      return <ListTag key={block.id} style={{ textAlign: block.align }}>{block.items.map((runs, index) => <li key={`${block.id}-${index}`}>{renderDescriptionRuns(runs, `${block.id}-${index}`)}</li>)}</ListTag>;
    }
    const style: CSSProperties = {
      textAlign: block.align,
      whiteSpace: "pre-wrap",
    };
    const content = renderDescriptionRuns(descriptionTextRuns(block), block.id);
    if (block.type === "heading" && block.level === 3) return <h6 key={block.id} style={style}>{content}</h6>;
    if (block.type === "heading") return <h5 key={block.id} style={style}>{content}</h5>;
    if (block.type === "quote") return <blockquote key={block.id} style={style}>{content}</blockquote>;
    return <p key={block.id} style={style}>{content}</p>;
  })}</div>;
}

function descriptionTextColor(color: DescriptionTextRun["color"]) {
  return color === "green" ? "var(--accent)" : color === "blue" ? "#4f86c7" : color === "gold" ? "#b47d2c" : color === "red" ? "#c25959" : color === "purple" ? "#8a6db1" : color === "gray" ? "var(--muted)" : "var(--ink)";
}

function descriptionRunStyle(run: DescriptionTextRun): CSSProperties {
  return {
    color: descriptionTextColor(run.color),
    fontSize: run.sizePx != null ? `${run.sizePx}px` : run.size === "small" ? ".82em" : run.size === "large" ? "1.2em" : run.size === "xlarge" ? "1.5em" : undefined,
    fontWeight: run.bold ? 850 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    fontFamily: descriptionFontFamilies[run.font] ?? undefined,
    textDecoration: [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
  };
}

function renderDescriptionRuns(runs: DescriptionTextRun[], keyPrefix: string) {
  return runs.map((run, index) => run.href
    ? <a key={`${keyPrefix}-${index}`} href={run.href} target="_blank" rel="noopener noreferrer" style={descriptionRunStyle(run)}>{run.text}</a>
    : <span key={`${keyPrefix}-${index}`} style={descriptionRunStyle(run)}>{run.text}</span>);
}

function StaffDiscordContact({ value, nickname, onCopy }: { value: string; nickname: string; onCopy: (value: string, message: string) => void }) {
  const href = safeHttpsUrl(value);
  if (href) return <a href={href} target="_blank" rel="noreferrer"><MessageCircle size={12} /> 개인 Discord 열기</a>;
  return <button type="button" title={`${value} 복사`} onClick={() => onCopy(value, `${nickname} 운영진의 Discord 아이디를 복사했습니다.`)}><MessageCircle size={12} /> Discord · {value} <Copy size={11} /></button>;
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeEmbedAttribute(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function ServerRow({ server, rank, favorite, onFavorite, onCopy, onOpen }: { server: Server; rank?: number; favorite: boolean; onFavorite: () => void; onCopy: () => void; onOpen: () => void; }) {
  const playerRate = server.capacity > 0 ? Math.min(100, Math.round((server.players / server.capacity) * 100)) : 0;
  return <article className={server.sponsored ? "server-row sponsored-row" : "server-row"}>
    <div className="row-rank">{server.sponsored ? <span>AD</span> : <b>{String(rank).padStart(2,"0")}</b>}</div>
    <ServerIcon server={server} />
    <div className="server-main"><div className="server-title"><button type="button" onClick={onOpen}>{server.name}</button>{server.verified && <BadgeCheck size={14} aria-label="운영자 인증 완료" />}{server.tags.slice(0,2).map((tag) => <span key={tag}>{tag}</span>)}</div><p>{server.summary}</p><button className="address-button" type="button" onClick={onCopy}><Copy size={12} />{server.address}<span>복사</span></button></div>
    <button className="banner-open" type="button" onClick={onOpen} aria-label={`${server.name} 배너로 상세보기`}><PromoBanner server={server} /></button>
    <div className="row-data version-data"><span>{server.edition}</span><b>{server.version}</b></div>
    <div className="row-data player-data"><b>{formatPlayers(server.players)}<small> / {server.capacity > 0 ? formatPlayers(server.capacity) : "-"}</small></b><i style={{"--players":`${playerRate}%`} as CSSProperties} /><span>{server.online ? `${server.latency}ms · ${server.uptime}%` : "오프라인"}</span></div>
    <div className="row-data vote-data"><b>{formatPlayers(server.votes)}</b><span>{server.growth >= 0 ? "+" : ""}{server.growth}%</span></div>
    <div className="row-actions"><button type="button" className={favorite ? "favorite active" : "favorite"} aria-label={favorite ? `${server.name} 즐겨찾기 해제` : `${server.name} 즐겨찾기`} aria-pressed={favorite} onClick={onFavorite}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button><button type="button" onClick={onOpen} aria-label={`${server.name} 상세보기`}><ArrowUpRight size={17} /></button></div>
  </article>;
}

function SmallServerRow({ server, rank, favorite, onFavorite, onCopy, onOpen }: { server: Server; rank: number; favorite: boolean; onFavorite: () => void; onCopy: () => void; onOpen: () => void; }) {
  return <article className="small-server-row">
    <div className="small-row-rank"><small>추천</small><b>{String(rank).padStart(2, "0")}</b></div>
    <ServerIcon server={server} />
    <div className="small-row-main">
      <div className="small-row-kicker"><span className={server.online ? "online" : "offline"}>{server.online ? "NOW ONLINE" : "OFFLINE"}</span>{server.verified && <span><BadgeCheck size={11} aria-hidden="true" /> 운영자 인증</span>}</div>
      <div className="server-title"><button type="button" onClick={onOpen}>{server.name}</button>{server.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
      <p>{server.summary}</p>
      <button className="address-button" type="button" onClick={onCopy}><Copy size={12} />{server.address}<span>복사</span></button>
    </div>
    <button className="small-row-banner" type="button" onClick={onOpen} aria-label={`${server.name} 배너로 상세보기`}><PromoBanner server={server} /></button>
    <div className="small-row-metrics">
      <span className="average"><small>7일 평균 동접</small><b>{formatPlayers(server.averagePlayers7d ?? 0)}명</b><em>20명 미만</em></span>
      <span><small>현재 접속</small><b>{server.online ? `${formatPlayers(server.players)}명` : "OFF"}</b><em>{server.online ? `${server.latency}ms` : "응답 없음"}</em></span>
      <span><small>신뢰 점수</small><b>{server.trust}점</b><em>{server.trustGrade} · {server.trustLabel}</em></span>
      <span><small>누적 추천</small><b>{formatPlayers(server.votes)}</b><em>{server.growth >= 0 ? "+" : ""}{server.growth}%</em></span>
    </div>
    <div className="small-row-actions"><button type="button" className={favorite ? "favorite active" : "favorite"} aria-label={favorite ? `${server.name} 즐겨찾기 해제` : `${server.name} 즐겨찾기`} aria-pressed={favorite} onClick={onFavorite}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button><button type="button" onClick={onOpen} aria-label={`${server.name} 상세보기`}><ArrowUpRight size={17} /></button></div>
  </article>;
}

function themeFromId(id: string) {
  let value = 0;
  for (const character of id) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return ["mint", "orange", "blue", "purple"][value % 4];
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MC";
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 10) return "방금 전";
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86_400)}일 전`;
}

function trendChartUpperBound(peakPlayers: number) {
  const peak = Math.max(0, Math.ceil(peakPlayers));
  if (peak === 0) return 1;
  const padded = peak + Math.max(1, Math.ceil(peak * 0.15));
  if (padded <= 10) return padded;
  if (padded <= 50) return Math.ceil(padded / 5) * 5;
  if (padded <= 100) return Math.ceil(padded / 10) * 10;
  if (padded <= 500) return Math.ceil(padded / 25) * 25;
  return Math.ceil(padded / 100) * 100;
}

function formatTrendMoment(bucketAt: number) {
  const date = new Date(bucketAt * 1000);
  return Number.isNaN(date.getTime()) ? "기록 시간 확인 불가" : new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

function formatTrendAxis(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}
