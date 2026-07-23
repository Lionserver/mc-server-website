import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const ownerHeaders = { Origin: origin, "Content-Type": "application/json", "X-MKR-Local-Owner": "minecraft-kr-local-preview" };
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const title = `Admin smoke ${suffix}`;
const address = `admin-${suffix}.minecraft.kr`;
let cookie = "";
let serverId = "";
let blacklistId = "";
const enforcementIds = [];

const adminFetch = (pathname, init = {}) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
});

const crossSiteLogin = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "000000" }),
});
assert.equal(crossSiteLogin.status, 403);

const invalidOtp = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json", "User-Agent": `admin-smoke-invalid-${suffix}` },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "999999" }),
});
assert.equal(invalidOtp.status, 401);

const login = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "000000" }),
});
assert.equal(login.status, 200);
const sessionCookie = login.headers.get("set-cookie") ?? "";
assert.match(sessionCookie, /HttpOnly/i);
assert.match(sessionCookie, /SameSite=Strict/i);
cookie = sessionCookie.split(";")[0] ?? "";
assert.match(cookie, /^mkr_admin_session=/);

try {
  const overview = await adminFetch("/api/admin/overview");
  assert.equal(overview.status, 200);

  const create = await fetch(`${baseUrl}/api/servers`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      title,
      shortDescription: "총관리자 기능 자동 검증 서버",
      description: "총관리자 OTP, 수치, 프리미엄, 직통라인, 블랙리스트와 삭제 흐름을 검증합니다.",
      edition: "JE",
      minVersion: "1.20.4",
      maxVersion: "1.21.8",
      address,
      port: 25565,
      categories: ["야생", "경제"],
    }),
  });
  assert.equal(create.status, 201);
  serverId = (await create.json()).server.id;

  const controls = await adminFetch(`/api/admin/servers/${serverId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ votesOverride: 54321, uptime: 98.76, premiumTier: "premium", premiumStartsAt: null, premiumEndsAt: null, premiumNote: "자동 검증" }),
  });
  assert.equal(controls.status, 200);

  const state = await fetch(`${baseUrl}/api/servers/state?ids=${serverId}`);
  assert.equal(state.status, 200);
  const stateBody = await state.json();
  assert.equal(stateBody.states[0].votesOverride, 54321);
  assert.equal(stateBody.states[0].uptime, 98.76);
  assert.equal(stateBody.states[0].premiumActive, true);

  const adjusted = await adminFetch(`/api/admin/servers/${serverId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "adjust_metrics", votesDelta: 9, uptimeDelta: -1.25 }),
  });
  assert.equal(adjusted.status, 200);
  const adjustedState = await fetch(`${baseUrl}/api/servers/state?ids=${serverId}`);
  const adjustedBody = await adjustedState.json();
  assert.equal(adjustedBody.states[0].votesOverride, null);
  assert.equal(adjustedBody.states[0].votes, 54330);
  assert.equal(adjustedBody.states[0].uptime, 97.51);

  const resetMetrics = await adminFetch(`/api/admin/servers/${serverId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reset_metric_adjustments" }),
  });
  assert.equal(resetMetrics.status, 200);
  const resetState = await fetch(`${baseUrl}/api/servers/state?ids=${serverId}`);
  const resetBody = await resetState.json();
  assert.equal(resetBody.states[0].votes, 0);
  assert.equal(resetBody.states[0].votesAdjustment, 0);
  assert.equal(resetBody.states[0].uptimeAdjustment, 0);

  const ownerMessage = await fetch(`${baseUrl}/api/support/threads/${serverId}`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ body: "서버 운영자 자동 검증 메시지" }),
  });
  assert.equal(ownerMessage.status, 201);

  const adminThread = await adminFetch(`/api/admin/messages/${serverId}`);
  assert.equal(adminThread.status, 200);
  assert.equal((await adminThread.json()).messages.length, 1);

  const adminMessage = await adminFetch(`/api/admin/messages/${serverId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "총관리자 자동 검증 답변" }),
  });
  assert.equal(adminMessage.status, 201);

  const ownerThread = await fetch(`${baseUrl}/api/support/threads/${serverId}`, { headers: ownerHeaders });
  assert.equal(ownerThread.status, 200);
  assert.equal((await ownerThread.json()).messages.length, 2);

  const warning = await adminFetch("/api/admin/enforcements", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, kind: "warning", reason: "자동 경고 검증", expiresAt: null }),
  });
  assert.equal(warning.status, 201);
  const warningId = (await warning.json()).enforcement.id;
  enforcementIds.push(warningId);
  const warnedMine = await fetch(`${baseUrl}/api/servers?mine=1`, { headers: ownerHeaders });
  assert.equal(warnedMine.status, 200);
  assert.ok((await warnedMine.json()).servers.find((server) => server.id === serverId).activeEnforcements.some((entry) => entry.kind === "warning"));
  const revokeWarning = await adminFetch(`/api/admin/enforcements/${warningId}`, { method: "DELETE" });
  assert.equal(revokeWarning.status, 204);

  const blind = await adminFetch("/api/admin/enforcements", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, kind: "blind", reason: "자동 블라인드 검증", expiresAt: Math.floor(Date.now() / 1000) + 300 }),
  });
  assert.equal(blind.status, 201);
  const blindId = (await blind.json()).enforcement.id;
  enforcementIds.push(blindId);
  const blindedOverview = await adminFetch("/api/admin/overview");
  assert.equal(blindedOverview.status, 200);
  assert.equal((await blindedOverview.json()).servers.find((server) => server.id === serverId).status, "blinded");
  const revokeBlind = await adminFetch(`/api/admin/enforcements/${blindId}`, { method: "DELETE" });
  assert.equal(revokeBlind.status, 204);

  const suspension = await adminFetch("/api/admin/enforcements", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, kind: "suspension", reason: "자동 기간 차단 검증", expiresAt: Math.floor(Date.now() / 1000) + 2 }),
  });
  assert.equal(suspension.status, 201);
  const suspensionId = (await suspension.json()).enforcement.id;
  enforcementIds.push(suspensionId);
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  const expiredOverview = await adminFetch("/api/admin/overview");
  assert.equal(expiredOverview.status, 200);
  const expiredBody = await expiredOverview.json();
  assert.equal(expiredBody.enforcements.find((entry) => entry.id === suspensionId).status, "expired");
  assert.equal(expiredBody.servers.find((server) => server.id === serverId).status, "draft");

  const blacklist = await adminFetch("/api/admin/blacklist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "address", value: address, reason: "자동 보안 검증" }),
  });
  assert.equal(blacklist.status, 201);
  blacklistId = (await blacklist.json()).entry.id;

  const blockedUpdate = await fetch(`${baseUrl}/api/servers/${serverId}`, {
    method: "PATCH",
    headers: ownerHeaders,
    body: JSON.stringify({
      title, shortDescription: "총관리자 기능 자동 검증 서버", description: "차단된 주소의 수정 요청도 거부되는지 자동으로 검증하는 충분히 긴 설명입니다.",
      edition: "JE", minVersion: "1.20.4", maxVersion: "1.21.8", address, port: 25565, categories: ["야생"],
    }),
  });
  assert.equal(blockedUpdate.status, 403);

  const blockedBridge = await fetch(`${baseUrl}/api/servers/${serverId}/bridge`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ platform: "paper" }),
  });
  assert.equal(blockedBridge.status, 403);

  const revoke = await adminFetch(`/api/admin/blacklist/${blacklistId}`, { method: "DELETE" });
  assert.equal(revoke.status, 204);
  blacklistId = "";
  const restoredState = await fetch(`${baseUrl}/api/servers/state?ids=${serverId}`);
  assert.equal(restoredState.status, 200);
  assert.equal((await restoredState.json()).states[0].hidden, false);

  const remove = await adminFetch(`/api/admin/servers/${serverId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: title, reason: "자동 검증 완료" }),
  });
  assert.equal(remove.status, 204);
  serverId = "";

  const finalOverview = await adminFetch("/api/admin/overview");
  assert.equal(finalOverview.status, 200);
  const finalBody = await finalOverview.json();
  assert.ok(finalBody.audits.some((entry) => entry.action === "server.deleted"));
  console.log("admin security smoke: passed");
} finally {
  for (const enforcementId of enforcementIds) await adminFetch(`/api/admin/enforcements/${enforcementId}`, { method: "DELETE" }).catch(() => undefined);
  if (blacklistId) await adminFetch(`/api/admin/blacklist/${blacklistId}`, { method: "DELETE" }).catch(() => undefined);
  if (serverId) await adminFetch(`/api/admin/servers/${serverId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: title, reason: "검증 정리" }) }).catch(() => undefined);
  if (cookie) await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
}
