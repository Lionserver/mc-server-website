import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const socketBase = baseUrl.replace(/^http/, "ws");
const ownerHeaders = { Origin: origin, "Content-Type": "application/json", "X-MKR-Local-Owner": "minecraft-kr-local-preview" };
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const titles = [`운영자 채널 A ${suffix}`, `운영자 채널 B ${suffix}`];
const servers = [];
const sockets = [];

function waitForJson(socket, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("WebSocket event timeout")), timeoutMs);
    const onMessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (predicate(payload)) finish(null, payload);
      } catch { /* malformed frames are ignored */ }
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
  await waitForJson(socket, (event) => event.type === "chat.ready");
  sockets.push(socket);
  return socket;
}

async function createServer(title, index) {
  const response = await fetch(`${baseUrl}/api/servers`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      title,
      shortDescription: "운영자 공용 실시간 대화방 회귀 검증 서버",
      description: "인증 서버 이름 고정, 공용 WebSocket 전달, 기록 조회와 전송 제한을 검증하는 임시 서버입니다.",
      edition: "JE",
      minVersion: "1.20.4",
      maxVersion: "1.21.8",
      address: `operator-chat-${index}-${suffix}.minecraft.kr`,
      port: 25565,
      categories: ["야생"],
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  servers.push({ id: body.server.id, title });
  return body.server.id;
}

function localD1Path() {
  const directory = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const name = readdirSync(directory).find((entry) => entry.endsWith(".sqlite") && entry !== "metadata.sqlite");
  assert.ok(name, "local D1 sqlite file was not found");
  return `${directory}/${name}`;
}

try {
  const firstId = await createServer(titles[0], 1);
  const secondId = await createServer(titles[1], 2);

  const blocked = await fetch(`${baseUrl}/api/operator/channel?serverId=${firstId}`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(blocked.status, 403, "unverified servers must not enter the operator channel");

  execFileSync("sqlite3", [localD1Path(), `PRAGMA busy_timeout=5000; UPDATE directory_servers SET status='active', owner_verification_status='verified', owner_verified_at=strftime('%s','now') WHERE id IN ('${firstId}','${secondId}');`]);

  const ticketResponses = await Promise.all([firstId, secondId].map((serverId) => fetch(`${baseUrl}/api/realtime/ticket`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ role: "owner", serverId, channel: "operators" }),
  })));
  ticketResponses.forEach((response) => assert.equal(response.status, 201));
  const tokens = await Promise.all(ticketResponses.map(async (response) => (await response.json()).token));
  const [firstSocket, secondSocket] = await Promise.all(tokens.map(openRealtime));

  const body = `공용 채널 실시간 검증 ${suffix}`;
  const firstReceive = waitForJson(firstSocket, (event) => event.type === "chat.message" && event.message?.body === body);
  const secondReceive = waitForJson(secondSocket, (event) => event.type === "chat.message" && event.message?.body === body);
  const send = await fetch(`${baseUrl}/api/operator/channel`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ serverId: firstId, body }),
  });
  assert.equal(send.status, 201);
  const sent = await send.json();
  assert.equal(sent.message.serverTitle, titles[0]);
  const [firstEvent, secondEvent] = await Promise.all([firstReceive, secondReceive]);
  assert.equal(firstEvent.message.server_title, titles[0]);
  assert.equal(secondEvent.message.server_title, titles[0]);

  const history = await fetch(`${baseUrl}/api/operator/channel?serverId=${secondId}`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(history.status, 200);
  const historyBody = await history.json();
  assert.equal(historyBody.messages.some((message) => message.id === sent.message.id && message.serverTitle === titles[0]), true);

  const throttled = await fetch(`${baseUrl}/api/operator/channel`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ serverId: secondId, body: "연속 전송 제한 검증" }),
  });
  assert.equal(throttled.status, 429);

  console.log("operator channel smoke: passed (verified access, server-name identity, global realtime, history, throttle)");
} finally {
  sockets.forEach((socket) => socket.close(1000, "test complete"));
  for (const server of servers) {
    await fetch(`${baseUrl}/api/servers/${server.id}`, {
      method: "DELETE",
      headers: ownerHeaders,
      body: JSON.stringify({ confirmation: server.title }),
    }).catch(() => undefined);
  }
}
