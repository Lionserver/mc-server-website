import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const socketBase = baseUrl.replace(/^http/, "ws");
const ownerHeaders = {
  Origin: origin,
  "Content-Type": "application/json",
  "X-MKR-Local-Owner": "minecraft-kr-local-preview",
};
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const title = `Realtime smoke ${suffix}`;
let cookie = "";
let serverId = "";
let ownerSocket;
let adminSocket;

const adminFetch = (pathname, init = {}) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
});

function waitForJson(socket, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("WebSocket event timeout")), timeoutMs);
    const onMessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (predicate(payload)) finish(null, payload);
      } catch {
        // Ignore non-JSON transport frames.
      }
    };
    const onClose = (event) => finish(new Error(`WebSocket closed early (${event.code})`));
    const onError = () => finish(new Error("WebSocket transport error"));
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      if (error) reject(error); else resolve(value);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  });
}

async function openRealtime(token) {
  const socket = new WebSocket(`${socketBase}/api/realtime/chat?ticket=${encodeURIComponent(token)}`);
  const ready = waitForJson(socket, (event) => event.type === "chat.ready");
  await ready;
  assert.equal(socket.readyState, WebSocket.OPEN);
  return socket;
}

async function assertTicketCannotBeReused(token) {
  const socket = new WebSocket(`${socketBase}/api/realtime/chat?ticket=${encodeURIComponent(token)}`);
  const rejected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 2000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(false); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); resolve(true); }, { once: true });
    socket.addEventListener("close", () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
  socket.close();
  assert.equal(rejected, true, "consumed realtime tickets must be single-use");
}

const login = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "000000" }),
});
assert.equal(login.status, 200);
cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
assert.match(cookie, /^mkr_admin_session=/);

try {
  const create = await fetch(`${baseUrl}/api/servers`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      title,
      shortDescription: "실시간 직통라인 자동 검증 서버",
      description: "운영자와 총관리자 양방향 WebSocket 즉시 전송을 자동으로 검증하기 위한 임시 서버입니다.",
      edition: "JE",
      minVersion: "1.20.4",
      maxVersion: "1.21.8",
      address: `realtime-${suffix}.minecraft.kr`,
      port: 25565,
      categories: ["야생"],
    }),
  });
  assert.equal(create.status, 201);
  serverId = (await create.json()).server.id;

  const [ownerTicketResponse, adminTicketResponse] = await Promise.all([
    fetch(`${baseUrl}/api/realtime/ticket`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ role: "owner", serverId }),
    }),
    adminFetch("/api/realtime/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    }),
  ]);
  assert.equal(ownerTicketResponse.status, 201);
  assert.equal(adminTicketResponse.status, 201);
  const ownerTicket = (await ownerTicketResponse.json()).token;
  const adminTicket = (await adminTicketResponse.json()).token;

  [ownerSocket, adminSocket] = await Promise.all([openRealtime(ownerTicket), openRealtime(adminTicket)]);
  await assertTicketCannotBeReused(ownerTicket);

  const ownerBody = `owner realtime ${suffix}`;
  const ownerOnOwner = waitForJson(ownerSocket, (event) => event.type === "chat.message" && event.message?.body === ownerBody);
  const ownerOnAdmin = waitForJson(adminSocket, (event) => event.type === "chat.message" && event.message?.body === ownerBody);
  const ownerSend = await fetch(`${baseUrl}/api/support/threads/${serverId}`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ body: ownerBody }),
  });
  assert.equal(ownerSend.status, 201);
  const ownerSent = await ownerSend.json();
  assert.equal(ownerSent.realtime, true);
  const [ownerEcho, adminReceive] = await Promise.all([ownerOnOwner, ownerOnAdmin]);
  assert.equal(ownerEcho.message.id, ownerSent.message.id);
  assert.equal(adminReceive.message.id, ownerSent.message.id);

  const adminBody = `admin realtime ${suffix}`;
  const adminOnOwner = waitForJson(ownerSocket, (event) => event.type === "chat.message" && event.message?.body === adminBody);
  const adminOnAdmin = waitForJson(adminSocket, (event) => event.type === "chat.message" && event.message?.body === adminBody);
  const adminSend = await adminFetch(`/api/admin/messages/${serverId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: adminBody }),
  });
  assert.equal(adminSend.status, 201);
  const adminSent = await adminSend.json();
  assert.equal(adminSent.realtime, true);
  const [ownerReceive, adminEcho] = await Promise.all([adminOnOwner, adminOnAdmin]);
  assert.equal(ownerReceive.message.id, adminSent.message.id);
  assert.equal(adminEcho.message.id, adminSent.message.id);

  const unreadResponse = await fetch(`${baseUrl}/api/support/threads/${serverId}?markRead=0`, {
    headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" },
  });
  assert.equal(unreadResponse.status, 200);
  assert.equal((await unreadResponse.json()).unreadOwner, 1, "background thread loading must preserve NEW state");
  const readResponse = await fetch(`${baseUrl}/api/support/threads/${serverId}`, {
    headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" },
  });
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).unreadOwner, 0, "opening the direct line must mark messages as read");
  const clearedResponse = await fetch(`${baseUrl}/api/support/threads/${serverId}?markRead=0`, {
    headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" },
  });
  assert.equal((await clearedResponse.json()).unreadOwner, 0);

  console.log("chat realtime smoke: passed (owner ↔ admin, single-use ticket, NEW/read state)");
} finally {
  ownerSocket?.close(1000, "test complete");
  adminSocket?.close(1000, "test complete");
  if (serverId) {
    await adminFetch(`/api/admin/servers/${serverId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: title, reason: "실시간 자동 검증 정리" }),
    }).catch(() => undefined);
  }
  if (cookie) await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
}
