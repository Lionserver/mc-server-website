"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, Clock3, Megaphone, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PublicAnnouncement = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  startsAt: number;
  endsAt: number;
  updatedAt: number;
};

export type AnnouncementPayload = {
  announcements: PublicAnnouncement[];
  nextTransitionAt: number | null;
  serverTime: number;
};

const EMPTY_ANNOUNCEMENT_PAYLOAD: AnnouncementPayload = {
  announcements: [],
  nextTransitionAt: null,
  serverTime: 0,
};

const periodFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fullPeriodFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function SiteAnnouncementBanner({
  initialPayload = EMPTY_ANNOUNCEMENT_PAYLOAD,
}: { initialPayload?: AnnouncementPayload }) {
  const [payload, setPayload] = useState<AnnouncementPayload>(initialPayload);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(initialPayload.announcements[0]?.id ?? "");
  const [serverNow, setServerNow] = useState(initialPayload.serverTime);
  const bannerRef = useRef<HTMLElement | null>(null);
  const payloadReceivedAtRef = useRef(0);
  const requestSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequenceRef.current;
    try {
      const response = await fetch("/api/announcements", { cache: "no-store" });
      const next = await response.json() as AnnouncementPayload & { error?: string };
      if (!response.ok || !Array.isArray(next.announcements)) throw new Error(next.error ?? "공지사항을 불러오지 못했습니다.");
      if (sequence !== requestSequenceRef.current) return;
      payloadReceivedAtRef.current = Date.now();
      setPayload(next);
      setServerNow(next.serverTime);
      setSelectedId((current) => next.announcements.some((announcement) => announcement.id === current)
        ? current
        : next.announcements[0]?.id ?? "");
      if (next.announcements.length === 0) setOpen(false);
    } catch {
      // Keep the last successfully loaded announcement during a transient network failure.
    }
  }, []);

  useEffect(() => {
    if (payloadReceivedAtRef.current === 0) payloadReceivedAtRef.current = Date.now();
    const initial = initialPayload.serverTime === 0
      ? window.setTimeout(() => void load(), 0)
      : null;
    const refresh = () => void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("site-announcements:refresh", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (initial != null) window.clearTimeout(initial);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("site-announcements:refresh", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [initialPayload.serverTime, load]);

  useEffect(() => {
    const serverNowMs = payload.serverTime > 0
      ? payload.serverTime * 1000 + (Date.now() - payloadReceivedAtRef.current)
      : Date.now();
    const boundaryDelay = payload.nextTransitionAt == null
      ? 60_000
      : payload.nextTransitionAt * 1000 - serverNowMs + 250;
    const delay = boundaryDelay <= 0
      ? 5_000
      : Math.max(250, Math.min(60_000, boundaryDelay));
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const estimatedServerNow = payload.serverTime > 0
        ? Math.floor((payload.serverTime * 1000 + Date.now() - payloadReceivedAtRef.current) / 1000)
        : Math.floor(Date.now() / 1000);
      setServerNow(estimatedServerNow);
      if (payload.announcements.some((announcement) => announcement.endsAt <= estimatedServerNow)) setOpen(false);
      void load();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [load, payload.announcements, payload.nextTransitionAt, payload.serverTime, serverNow]);

  const announcements = payload.announcements.filter((announcement) =>
    serverNow === 0 || (announcement.startsAt <= serverNow && announcement.endsAt > serverNow));
  const selected = useMemo(
    () => announcements.find((announcement) => announcement.id === selectedId) ?? announcements[0] ?? null,
    [announcements, selectedId],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (announcements.length === 0 || !bannerRef.current) {
      delete root.dataset.siteAnnouncementVisible;
      root.style.setProperty("--site-announcement-height", "0px");
      return;
    }
    root.dataset.siteAnnouncementVisible = "true";
    const banner = bannerRef.current;
    const updateHeight = () => root.style.setProperty("--site-announcement-height", `${Math.ceil(banner.getBoundingClientRect().height)}px`);
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(banner);
    return () => {
      observer?.disconnect();
      delete root.dataset.siteAnnouncementVisible;
      root.style.setProperty("--site-announcement-height", "0px");
    };
  }, [announcements.length]);

  if (!announcements.length || !selected) return null;
  const lead = announcements[0];
  const selectedIndex = Math.max(0, announcements.findIndex((announcement) => announcement.id === selected.id));
  const selectedTabId = `site-announcement-tab-${selectedIndex}`;
  const detailPanelId = "site-announcement-detail-panel";

  return <aside ref={bannerRef} className="site-announcement-banner" aria-label="서비스 공지" aria-live="polite" data-nosnippet>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="site-announcement-trigger" type="button" aria-label={`${lead.title} 공지 상세 열기`}>
          <span className="site-announcement-label"><Megaphone size={14} aria-hidden="true" /> 공지</span>
          <span className="site-announcement-copy"><b>{lead.title}</b><span>{lead.summary}</span></span>
          <span className="site-announcement-meta">
            {announcements.length > 1 && <span className="site-announcement-count">외 {announcements.length - 1}건</span>}
            <time className="site-announcement-period" dateTime={new Date(lead.endsAt * 1000).toISOString()}>
              {periodFormatter.format(lead.startsAt * 1000)} – {periodFormatter.format(lead.endsAt * 1000)} KST
            </time>
            <span className="site-announcement-cta">자세히 <ChevronRight size={14} aria-hidden="true" /></span>
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="site-announcement-backdrop" />
        <Dialog.Content className="site-announcement-dialog" aria-describedby="site-announcement-description">
          <div className="site-announcement-dialog-head">
            <span><Megaphone size={15} aria-hidden="true" /> SERVICE NOTICE</span>
            <Dialog.Close asChild><button type="button" aria-label="공지 상세 닫기"><X size={18} /></button></Dialog.Close>
          </div>
          {announcements.length > 1 && <nav className="site-announcement-dialog-tabs" role="tablist" aria-label="현재 공지 목록">
            {announcements.map((announcement, index) => <button
              type="button"
              key={announcement.id}
              id={`site-announcement-tab-${index}`}
              className={selected.id === announcement.id ? "active" : ""}
              role="tab"
              aria-selected={selected.id === announcement.id}
              aria-controls={detailPanelId}
              tabIndex={selected.id === announcement.id ? 0 : -1}
              onClick={() => setSelectedId(announcement.id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? announcements.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + announcements.length) % announcements.length;
                setSelectedId(announcements[nextIndex].id);
                window.requestAnimationFrame(() => document.getElementById(`site-announcement-tab-${nextIndex}`)?.focus());
              }}
            >{announcement.title}</button>)}
          </nav>}
          <div
            className="site-announcement-dialog-body"
            id={detailPanelId}
            role={announcements.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={announcements.length > 1 ? selectedTabId : undefined}
            tabIndex={announcements.length > 1 ? 0 : undefined}
          >
            <span className="site-announcement-dialog-kicker">MINECRAFT.KR 운영 안내</span>
            <Dialog.Title>{selected.title}</Dialog.Title>
            <Dialog.Description id="site-announcement-description" className="site-announcement-dialog-summary">{selected.summary}</Dialog.Description>
            <div className="site-announcement-dialog-time"><Clock3 size={15} aria-hidden="true" /><span><b>공지 적용 기간</b><time dateTime={new Date(selected.startsAt * 1000).toISOString()}>{fullPeriodFormatter.format(selected.startsAt * 1000)}</time><i>–</i><time dateTime={new Date(selected.endsAt * 1000).toISOString()}>{fullPeriodFormatter.format(selected.endsAt * 1000)} KST</time></span></div>
            <div className="site-announcement-detail">{selected.detail}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </aside>;
}
