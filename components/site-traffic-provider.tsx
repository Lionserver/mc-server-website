"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isCountablePublicPath } from "@/lib/site-traffic";

type SiteTrafficState = {
  todayVisitors: number | null;
  available: boolean;
};

const SiteTrafficContext = createContext<SiteTrafficState>({
  todayVisitors: null,
  available: true,
});

export function SiteTrafficProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const requestedDay = useRef("");
  const mounted = useRef(true);
  const [state, setState] = useState<SiteTrafficState>({
    todayVisitors: null,
    available: true,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isCountablePublicPath(pathname)) return;
    let dayTimer: number | null = null;

    const record = async () => {
      const day = clientKstDay();
      if (requestedDay.current === day || document.visibilityState !== "visible") return;
      requestedDay.current = day;
      try {
        const response = await fetch("/api/traffic/today", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          keepalive: true,
        });
        const body = await response.json() as { visitors?: number };
        if (!response.ok || !Number.isSafeInteger(body.visitors) || (body.visitors ?? -1) < 0) {
          requestedDay.current = "";
          if (mounted.current) setState({ todayVisitors: null, available: false });
          return;
        }
        if (mounted.current) setState({ todayVisitors: body.visitors as number, available: true });
      } catch {
        requestedDay.current = "";
        if (mounted.current) setState({ todayVisitors: null, available: false });
      }
    };

    const scheduleNextDay = () => {
      if (dayTimer !== null) window.clearTimeout(dayTimer);
      dayTimer = window.setTimeout(() => {
        void record();
        scheduleNextDay();
      }, millisecondsUntilNextKstDay());
    };
    const recordWhenVisible = () => {
      if (document.visibilityState === "visible") void record();
    };
    void record();
    scheduleNextDay();
    document.addEventListener("visibilitychange", recordWhenVisible);
    return () => {
      if (dayTimer !== null) window.clearTimeout(dayTimer);
      document.removeEventListener("visibilitychange", recordWhenVisible);
    };
  }, [pathname]);

  return <SiteTrafficContext.Provider value={state}>{children}</SiteTrafficContext.Provider>;
}

export function useSiteTraffic() {
  return useContext(SiteTrafficContext);
}

function clientKstDay(now = Date.now()) {
  return new Date(now + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function millisecondsUntilNextKstDay(now = Date.now()) {
  const shifted = new Date(now + 9 * 60 * 60_000);
  const nextMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - 9 * 60 * 60_000;
  return Math.max(1_000, nextMidnightUtc - now + 1_000);
}
