"use client";
/* eslint-disable @next/next/no-img-element -- Official live thumbnails and channel images are remote platform assets. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ExternalLink, Eye, Radio, RefreshCw, Tv } from "lucide-react";
import Link from "next/link";
import { PublicSiteHeader } from "@/components/public-site-header";
import { ServerRegistrationDialog } from "@/components/server-registration-dialog";
import {
  STREAM_PREVIEW_CACHE_SECONDS, STREAM_PROFILE_CACHE_SECONDS, type MinecraftLiveStream, type MinecraftStreamsPayload, type StreamPlatform,
} from "@/lib/minecraft-streams";

type ThemeMode = "light" | "dark";
type PlatformFilter = "all" | StreamPlatform;

const viewers = new Intl.NumberFormat("ko-KR");

export default function MinecraftBroadcastsPage() {
  const [payload, setPayload] = useState<MinecraftStreamsPayload | null>(null);
  const [filter, setFilter] = useState<PlatformFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerSession, setOwnerSession] = useState<{ email: string } | null>(null);
  const [ownerSessionChecked, setOwnerSessionChecked] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const response = await fetch("/api/streams/minecraft", { cache: "no-store" });
      const next = await response.json() as MinecraftStreamsPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "방송 목록을 불러오지 못했습니다.");
      setPayload(next);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "방송 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  useEffect(() => {
    const stored = window.localStorage.getItem("minecraft-kr-theme") as ThemeMode | null;
    const next = stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = next;
    const frame = window.requestAnimationFrame(() => setTheme(next));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let active = true;
    const syncSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const body = await response.json() as { authenticated?: boolean; email?: string };
        if (active) {
          const session = response.ok && body.authenticated && body.email ? { email: body.email } : null;
          setOwnerSession(session);
          if (session && new URLSearchParams(window.location.search).get("register") === "1") {
            setRegistrationOpen(true);
            const url = new URL(window.location.href);
            url.searchParams.delete("register");
            window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          }
        }
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

  const filtered = useMemo(() => payload?.streams.filter((stream) => filter === "all" || stream.platform === filter) ?? [], [filter, payload]);
  const chzzkCount = payload?.streams.filter((stream) => stream.platform === "chzzk").length ?? 0;
  const soopCount = payload?.streams.filter((stream) => stream.platform === "soop").length ?? 0;
  const totalViewers = payload?.streams.reduce((sum, stream) => sum + stream.viewerCount, 0) ?? 0;

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("minecraft-kr-theme", next);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function startRegistration() {
    if (!ownerSessionChecked) {
      showToast("로그인 상태를 확인하고 있습니다. 잠시 후 다시 눌러 주세요.");
      return;
    }
    if (!ownerSession) {
      window.location.assign("/login?returnTo=/broadcasts?register=1");
      return;
    }
    setRegistrationOpen(true);
    setMobileOpen(false);
  }

  return <div className="site-shell broadcast-shell">
    <a className="skip-link" href="#broadcast-list">방송 목록으로 건너뛰기</a>
    <PublicSiteHeader
      active="broadcasts"
      ownerSession={ownerSession}
      ownerSessionChecked={ownerSessionChecked}
      theme={theme}
      mobileOpen={mobileOpen}
      onMobileOpenChange={setMobileOpen}
      onToggleTheme={toggleTheme}
      onRegister={startRegistration}
    />

    <main>
      <section className="broadcast-hero">
        <div className="container broadcast-hero-grid">
          <div className="broadcast-hero-copy">
            <span><Radio size={14} aria-hidden="true" /> LIVE MINECRAFT NOW</span>
            <h1>지금 방송 중인<br /><em>마인크래프트</em></h1>
            <p>치지직과 SOOP의 공개 라이브 목록에서 마인크래프트 카테고리 방송만 모아 시청자 수 순으로 보여줍니다.</p>
          </div>
          <div className="broadcast-hero-stats" aria-label="마인크래프트 방송 현황">
            <div><small>LIVE CHANNELS</small><b>{loading ? "—" : viewers.format(payload?.streams.length ?? 0)}</b><span>방송 중</span></div>
            <div><small>WATCHING NOW</small><b>{loading ? "—" : viewers.format(totalViewers)}</b><span>현재 시청자</span></div>
          </div>
        </div>
      </section>

      <section className="broadcast-directory" id="broadcast-list">
        <div className="container">
          <div className="broadcast-directory-head">
            <div><span>STREAM DIRECTORY</span><h2>마크 방송</h2><p>시청자 수 높은 순 · 목록 60초 · 방송 장면 2분마다 갱신</p></div>
            <button type="button" disabled={refreshing} onClick={() => void load(true)}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> {refreshing ? "갱신 중" : "새로고침"}</button>
          </div>

          <div className="broadcast-source-bar" aria-label="방송 플랫폼 필터">
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 <b>{payload?.streams.length ?? 0}</b></button>
            <button type="button" className={filter === "chzzk" ? "active chzzk" : "chzzk"} onClick={() => setFilter("chzzk")}>치지직 <b>{chzzkCount}</b></button>
            <button type="button" className={filter === "soop" ? "active soop" : "soop"} onClick={() => setFilter("soop")}>SOOP <b>{soopCount}</b></button>
            <span>{payload ? `마지막 확인 ${new Date(payload.generatedAt * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "라이브 목록 연결 확인 중"}</span>
          </div>

          {error ? <div className="broadcast-empty error"><Activity size={25} /><h3>방송 목록 연결이 지연되고 있습니다</h3><p>{error}</p><button type="button" onClick={() => void load()}>다시 확인</button></div>
            : loading ? <div className="broadcast-grid" aria-label="방송 목록을 불러오는 중">{Array.from({ length: 6 }, (_, index) => <div className="broadcast-card-skeleton" key={index}><span /><i /><i /></div>)}</div>
              : filtered.length ? <div className="broadcast-grid">{filtered.map((stream) => <StreamCard
                  stream={stream}
                  previewVersion={Math.floor((payload?.generatedAt ?? 0) / STREAM_PREVIEW_CACHE_SECONDS)}
                  profileVersion={Math.floor((payload?.generatedAt ?? 0) / STREAM_PROFILE_CACHE_SECONDS)}
                  key={stream.id}
                />)}</div>
                : <div className="broadcast-empty"><Tv size={28} /><h3>현재 방송 중인 마인크래프트 채널이 없습니다</h3><p>마인크래프트 카테고리 방송이 시작되면 최대 60초 안에 이곳에 표시됩니다.</p></div>}
        </div>
      </section>
    </main>

    <footer className="broadcast-footer"><div className="container"><span>MINECRAFT.KR · LIVE DIRECTORY</span><p>방송 정보와 이미지는 각 플랫폼의 공개 라이브 목록에서 확인하며, 시청은 해당 플랫폼에서 진행됩니다.</p><Link href="/">서버 목록으로 돌아가기</Link></div></footer>
    <ServerRegistrationDialog open={registrationOpen} onOpenChange={setRegistrationOpen} onMessage={showToast} onCreated={(serverId) => { window.setTimeout(() => window.location.assign(`/operator?created=${serverId}`), 450); }} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function StreamCard({ stream, previewVersion, profileVersion }: { stream: MinecraftLiveStream; previewVersion: number; profileVersion: number }) {
  const previewUrl = `${stream.previewImageUrl}?v=${previewVersion}`;
  const profileUrl = `${stream.profileImageCacheUrl}?v=${profileVersion}`;
  return <article className={`broadcast-card platform-${stream.platform}`}>
    <a className="broadcast-thumbnail" href={stream.watchUrl} target="_blank" rel="noreferrer" aria-label={`${stream.streamerName} 방송 시청하기`}>
      <span className="broadcast-thumbnail-fallback" aria-hidden="true"><Radio size={24} /><b>미리보기 준비 중</b></span>
      <img src={previewUrl} alt={`${stream.streamerName} 방송 장면 미리보기`} loading="lazy" decoding="async" onError={(event) => {
        if (stream.thumbnailUrl && event.currentTarget.dataset.fallback !== "platform") {
          event.currentTarget.dataset.fallback = "platform";
          event.currentTarget.src = stream.thumbnailUrl;
        } else event.currentTarget.style.display = "none";
      }} />
      <span className="broadcast-live-badge">LIVE</span>
      <span className="broadcast-preview-label">2M SNAPSHOT</span>
      <span className="broadcast-viewers"><Eye size={12} /> {viewers.format(stream.viewerCount)}</span>
      {stream.adult && <span className="broadcast-adult">19</span>}
    </a>
    <div className="broadcast-card-body">
      <div className="broadcast-streamer">
        <span className="broadcast-avatar"><span aria-hidden="true">{stream.streamerName.slice(0, 1)}</span>{stream.profileImageUrl && <img
          src={profileUrl}
          alt={`${stream.streamerName} 프로필`}
          loading="lazy"
          decoding="async"
          onError={(event) => {
            if (event.currentTarget.dataset.fallback !== "platform") {
              event.currentTarget.dataset.fallback = "platform";
              event.currentTarget.src = stream.profileImageUrl;
            } else event.currentTarget.style.display = "none";
          }}
        />}</span>
        <div><span>{stream.platform === "chzzk" ? "CHZZK" : "SOOP"}</span><b>{stream.streamerName}</b></div>
      </div>
      <h3>{stream.title}</h3>
      <div className="broadcast-tags"><span>{stream.category}</span>{stream.tags.slice(0, 2).map((tag) => <i key={tag}>#{tag}</i>)}</div>
      <footer><span>{liveDuration(stream.startedAt)} 방송 중</span><a href={stream.watchUrl} target="_blank" rel="noreferrer">시청하기 <ExternalLink size={13} /></a></footer>
    </div>
  </article>;
}

function liveDuration(startedAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000));
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}
