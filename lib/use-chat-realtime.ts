"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatRealtimeEvent, ChatRealtimeRole } from "@/lib/chat-realtime";

export type ChatConnectionStatus = "idle" | "connecting" | "live" | "reconnecting" | "unavailable";

export function useChatRealtime(options: {
  enabled: boolean;
  role: ChatRealtimeRole;
  serverId?: string | null;
  channel?: "direct" | "operators";
  onEvent: (event: ChatRealtimeEvent) => void;
}) {
  const [status, setStatus] = useState<ChatConnectionStatus>("idle");
  const eventHandler = useRef(options.onEvent);
  useEffect(() => { eventHandler.current = options.onEvent; }, [options.onEvent]);

  useEffect(() => {
    if (!options.enabled || (options.role === "owner" && !options.serverId)) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    const scheduleReconnect = () => {
      if (!active || reconnectTimer !== null) return;
      attempts += 1;
      setStatus(attempts > 4 ? "unavailable" : "reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempts, 5)) + Math.floor(Math.random() * 300);
      reconnectTimer = window.setTimeout(() => { reconnectTimer = null; void connect(); }, delay);
    };

    const connect = async () => {
      if (!active || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");
      try {
        const response = await fetch("/api/realtime/ticket", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...localOwnerHeaders(options.role) },
          body: JSON.stringify({ role: options.role, serverId: options.serverId ?? null, channel: options.channel ?? "direct" }),
        });
        const body = await response.json() as { token?: string; error?: string };
        if (!response.ok || !body.token) throw new Error(body.error ?? "realtime ticket failed");
        if (!active) return;
        const url = new URL("/api/realtime/chat", window.location.href);
        url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", body.token);
        socket = new WebSocket(url);
        socket.addEventListener("open", () => { if (active) { attempts = 0; setStatus("live"); } });
        socket.addEventListener("message", (message) => {
          if (!active || typeof message.data !== "string") return;
          try {
            const event = JSON.parse(message.data) as ChatRealtimeEvent | { type?: string };
            if (event.type === "chat.message") eventHandler.current(event as ChatRealtimeEvent);
          } catch { /* ignore malformed realtime frames */ }
        });
        socket.addEventListener("close", () => { socket = null; scheduleReconnect(); });
        socket.addEventListener("error", () => socket?.close());
      } catch {
        socket = null;
        scheduleReconnect();
      }
    };

    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible" && (!socket || socket.readyState > WebSocket.OPEN)) {
        if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
        void connect();
      }
    };
    const reconnectWhenOnline = () => reconnectWhenVisible();
    const initialTimer = window.setTimeout(() => { void connect(); }, 0);
    document.addEventListener("visibilitychange", reconnectWhenVisible);
    window.addEventListener("online", reconnectWhenOnline);
    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", reconnectWhenVisible);
      window.removeEventListener("online", reconnectWhenOnline);
      socket?.close(1000, "view changed");
    };
  }, [options.channel, options.enabled, options.role, options.serverId]);

  return status;
}

function localOwnerHeaders(role: ChatRealtimeRole): Record<string, string> {
  if (role === "owner" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return { "X-MKR-Local-Owner": "minecraft-kr-local-preview" };
  }
  return {};
}
