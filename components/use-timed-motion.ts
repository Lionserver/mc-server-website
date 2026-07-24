"use client";

import { useEffect, useState } from "react";

const MOTION_WINDOW_MS = 5_000;

/**
 * Decorative GIF/WebM media gets a short preview window, then stops automatically.
 * The window never starts while the page is hidden or reduced motion is requested.
 */
export function useTimedMotion(resetKey: string | null | undefined) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");

    const stop = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      setActive(false);
    };
    const start = () => {
      stop();
      if (!resetKey || preference.matches || document.visibilityState !== "visible") return;
      setActive(true);
      timer = window.setTimeout(stop, MOTION_WINDOW_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    start();
    preference.addEventListener("change", start);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      preference.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [resetKey]);

  return active;
}
