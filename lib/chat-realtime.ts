import { ensureAdminSchema } from "@/lib/admin-security";
import { directoryEnv, type DirectoryEnv } from "@/lib/server-directory";

export type ChatRealtimeRole = "admin" | "owner";
export type ChatRealtimeEvent = {
  type: "chat.message";
  serverId: string;
  message: { id: string; sender_role: "admin" | "owner"; sender_email: string; body: string; created_at: number; server_title?: string };
};

export interface ChatRealtimeEnvironment extends DirectoryEnv {
  CHAT_ROOMS?: DurableObjectNamespace;
}

type TicketRow = {
  scope: "global" | "server" | "operators";
  server_id: string | null;
  role: ChatRealtimeRole;
  principal_email: string;
  expires_at: number;
};

const TICKET_SECONDS = 45;
export const CHAT_CONNECTION_SECONDS = 5 * 60;

export async function chatRealtimeEnv() {
  return await directoryEnv() as ChatRealtimeEnvironment;
}

export async function issueChatRealtimeTicket(db: D1Database, input: {
  scope: "global" | "server" | "operators";
  serverId?: string | null;
  role: ChatRealtimeRole;
  principalEmail: string;
}) {
  await ensureAdminSchema(db);
  const now = unixNow();
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + TICKET_SECONDS;
  await db.prepare(`INSERT INTO chat_realtime_tickets
    (token_hash, scope, server_id, role, principal_email, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(tokenHash, input.scope, input.serverId ?? null, input.role, input.principalEmail, expiresAt, now).run();
  return { token, expiresAt };
}

export async function consumeChatRealtimeTicket(db: D1Database, token: string) {
  if (token.length < 32 || token.length > 160) return null;
  await ensureAdminSchema(db);
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`DELETE FROM chat_realtime_tickets
    WHERE token_hash = ? AND expires_at > ?
    RETURNING scope, server_id, role, principal_email, expires_at`)
    .bind(tokenHash, unixNow()).first<TicketRow>();
  return row ?? null;
}

export async function broadcastChatEvent(environment: ChatRealtimeEnvironment, event: ChatRealtimeEvent) {
  if (!environment.CHAT_ROOMS) return false;
  const targets = [`server:${event.serverId}`, "global:admins"];
  await Promise.all(targets.map(async (name) => {
    const id = environment.CHAT_ROOMS?.idFromName(name);
    if (!id) return;
    const stub = environment.CHAT_ROOMS?.get(id);
    await stub?.fetch("https://chat.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MKR-Realtime-Internal": "broadcast" },
      body: JSON.stringify(event),
    });
  }));
  return true;
}

export async function broadcastOperatorChatEvent(environment: ChatRealtimeEnvironment, event: ChatRealtimeEvent) {
  if (!environment.CHAT_ROOMS) return false;
  const id = environment.CHAT_ROOMS.idFromName("global:operators");
  const stub = environment.CHAT_ROOMS.get(id);
  await stub.fetch("https://chat.internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MKR-Realtime-Internal": "broadcast" },
    body: JSON.stringify(event),
  });
  return true;
}

export function realtimeRoomName(ticket: TicketRow) {
  if (ticket.scope === "global") return "global:admins";
  if (ticket.scope === "operators") return "global:operators";
  return `server:${ticket.server_id}`;
}

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
