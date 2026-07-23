import assert from "node:assert/strict";
import net from "node:net";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const title = `Ownership smoke ${suffix}`;
let motd = "Minecraft.kr ownership smoke";
let serverId = "";
let adminCookie = "";

const minecraftServer = net.createServer((socket) => {
  let input = Buffer.alloc(0);
  let replied = false;
  socket.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    if (replied || completePacketCount(input) < 2) return;
    replied = true;
    const payload = Buffer.from(JSON.stringify({
      version: { name: "1.21.8 smoke", protocol: 769 },
      players: { online: 3, max: 100 },
      description: { text: motd },
    }));
    const body = Buffer.concat([encodeVarInt(0), encodeVarInt(payload.length), payload]);
    socket.end(Buffer.concat([encodeVarInt(body.length), body]));
  });
});

await new Promise((resolve, reject) => {
  minecraftServer.once("error", reject);
  minecraftServer.listen(0, "127.0.0.1", resolve);
});
const addressInfo = minecraftServer.address();
assert.ok(addressInfo && typeof addressInfo === "object");
const minecraftPort = addressInfo.port;

async function loginOwner(email) {
  const request = await fetch(`${baseUrl}/api/auth/email/request`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "User-Agent": `ownership-smoke-${email}-${suffix}` },
    body: JSON.stringify({ email }),
  });
  assert.equal(request.status, 201, await request.clone().text());
  const requested = await request.json();
  assert.match(requested.previewCode ?? "", /^\d{6}$/);
  const verify = await fetch(`${baseUrl}/api/auth/email/verify`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: requested.previewCode }),
  });
  assert.equal(verify.status, 200, await verify.clone().text());
  const cookie = (verify.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^mkr_owner_session=/);
  return cookie;
}

function ownerFetch(cookie, pathname, init = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
  });
}

function adminFetch(pathname, init = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Origin: origin, Cookie: adminCookie, ...(init.headers ?? {}) },
  });
}

const ownerEmail = `owner-${suffix}@example.com`;
const recipientEmail = `recipient-${suffix}@example.com`;
const claimantEmail = `claimant-${suffix}@example.com`;
const ownerCookie = await loginOwner(ownerEmail);
const recipientCookie = await loginOwner(recipientEmail);
const claimantCookie = await loginOwner(claimantEmail);
const adminLogin = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "000000" }),
});
assert.equal(adminLogin.status, 200, await adminLogin.text());
adminCookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0];

const directoryPayload = {
  title,
  shortDescription: "이메일 양도·서버 주장 자동 검증",
  description: "이메일 로그인부터 MOTD 양도, 소유권 분쟁과 총관리자 승인까지 자동 검증하는 임시 서버입니다.",
  edition: "JE",
  minVersion: "1.20.4",
  maxVersion: "1.21.8",
  address: "127-0-0-1.nip.io",
  port: minecraftPort,
  categories: ["야생"],
};

try {
  const create = await ownerFetch(ownerCookie, "/api/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(directoryPayload),
  });
  assert.equal(create.status, 201, await create.clone().text());
  serverId = (await create.json()).server.id;

  const posterForm = new FormData();
  posterForm.set("poster", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], "cookie-auth-poster.png", { type: "image/png" }));
  const posterUpload = await ownerFetch(ownerCookie, `/api/servers/${serverId}/description-assets`, { method: "POST", body: posterForm });
  assert.equal(posterUpload.status, 201, await posterUpload.clone().text());
  const posterId = (await posterUpload.json()).asset.id;
  const posterDelete = await ownerFetch(ownerCookie, `/api/servers/${serverId}/description-assets/${posterId}`, { method: "DELETE" });
  assert.equal(posterDelete.status, 204, await posterDelete.text());

  const transferRequest = await ownerFetch(ownerCookie, "/api/ownership/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, toEmail: recipientEmail }),
  });
  assert.equal(transferRequest.status, 201, await transferRequest.clone().text());
  const transferId = (await transferRequest.json()).transfer.id;

  const accept = await ownerFetch(recipientCookie, `/api/ownership/transfers/${transferId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept" }),
  });
  assert.equal(accept.status, 200, await accept.clone().text());
  const accepted = await accept.json();
  assert.match(accepted.marker, /^\[MKR-TRANSFER:[a-f0-9]{20}\]$/);
  motd = accepted.marker;

  const verifyTransfer = await ownerFetch(recipientCookie, `/api/ownership/transfers/${transferId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", verificationToken: accepted.verificationToken }),
  });
  assert.equal(verifyTransfer.status, 200, await verifyTransfer.clone().text());
  assert.equal((await verifyTransfer.json()).status, "completed");

  const originalOwnerServers = await ownerFetch(ownerCookie, "/api/servers?mine=1");
  assert.equal(originalOwnerServers.status, 200);
  assert.equal((await originalOwnerServers.json()).servers.some((server) => server.id === serverId), false);
  const recipientServers = await ownerFetch(recipientCookie, "/api/servers?mine=1");
  assert.equal(recipientServers.status, 200);
  assert.equal((await recipientServers.json()).servers.some((server) => server.id === serverId), true);

  const claimRequest = await ownerFetch(claimantCookie, "/api/ownership/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, method: "motd" }),
  });
  assert.equal(claimRequest.status, 201, await claimRequest.clone().text());
  const claim = await claimRequest.json();
  motd = claim.challenge.marker;

  const verifyClaim = await ownerFetch(claimantCookie, `/api/ownership/claims/${claim.claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", verificationToken: claim.verificationToken }),
  });
  assert.equal(verifyClaim.status, 200, await verifyClaim.clone().text());
  assert.equal((await verifyClaim.json()).status, "pending_review");

  const blockedEdit = await ownerFetch(recipientCookie, `/api/servers/${serverId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(directoryPayload),
  });
  assert.equal(blockedEdit.status, 423);

  const approve = await adminFetch(`/api/admin/ownership/claims/${claim.claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", note: "자동 통합 검증 승인" }),
  });
  assert.equal(approve.status, 200, await approve.clone().text());
  assert.equal((await approve.json()).status, "approved");

  const formerOwnerServers = await ownerFetch(recipientCookie, "/api/servers?mine=1");
  assert.equal((await formerOwnerServers.json()).servers.some((server) => server.id === serverId), false);
  const claimedServers = await ownerFetch(claimantCookie, "/api/servers?mine=1");
  const claimed = (await claimedServers.json()).servers.find((server) => server.id === serverId);
  assert.equal(claimed.ownerVerificationStatus, "verified");
  assert.equal(claimed.bridgeServerId, null);

  console.log("ownership auth smoke: passed");
} finally {
  if (serverId && adminCookie) {
    await adminFetch(`/api/admin/servers/${serverId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: title, reason: "소유권 통합 검증 정리" }),
    }).catch(() => undefined);
  }
  for (const cookie of [ownerCookie, recipientCookie, claimantCookie]) {
    await ownerFetch(cookie, "/api/auth/session", { method: "DELETE" }).catch(() => undefined);
  }
  if (adminCookie) await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
  await new Promise((resolve) => minecraftServer.close(resolve));
}

function completePacketCount(buffer) {
  let offset = 0;
  let count = 0;
  while (offset < buffer.length) {
    const decoded = decodeVarInt(buffer, offset);
    if (!decoded) return count;
    const end = offset + decoded.bytes + decoded.value;
    if (end > buffer.length) return count;
    count += 1;
    offset = end;
  }
  return count;
}

function decodeVarInt(buffer, start) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (start + index >= buffer.length) return null;
    const byte = buffer[start + index];
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) return { value, bytes: index + 1 };
  }
  throw new Error("invalid VarInt");
}

function encodeVarInt(input) {
  let value = input >>> 0;
  const bytes = [];
  do {
    let current = value & 0x7f;
    value >>>= 7;
    if (value !== 0) current |= 0x80;
    bytes.push(current);
  } while (value !== 0);
  return Buffer.from(bytes);
}
