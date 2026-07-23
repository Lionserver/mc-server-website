import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
let cookie = "";

const adminFetch = (pathname, init = {}) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
});

const login = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "000000" }),
});
assert.equal(login.status, 200, `admin login failed: ${login.status}`);
cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
assert.match(cookie, /^mkr_admin_session=/);

try {
  const beforeResponse = await adminFetch("/api/admin/cache");
  assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json();
  assert.ok(Number.isInteger(before.stats.objects));
  assert.ok(before.stats.bytes >= 0);

  const cleanupResponse = await adminFetch("/api/admin/cache", { method: "DELETE" });
  assert.equal(cleanupResponse.status, 200);
  const result = await cleanupResponse.json();
  assert.ok(result.cleanup.deleted >= 0);
  assert.ok(result.cleanup.deletedBytes >= 0);
  assert.ok(result.stats.objects <= before.stats.objects);
  assert.equal(result.stats.objects, before.stats.objects - result.cleanup.deleted);

  const afterResponse = await adminFetch("/api/admin/cache");
  assert.equal(afterResponse.status, 200);
  const after = await afterResponse.json();
  assert.equal(after.stats.objects, result.stats.objects);
  assert.equal(after.stats.bytes, result.stats.bytes);

  console.log(JSON.stringify({
    before: { objects: before.stats.objects, bytes: before.stats.bytes },
    deleted: { objects: result.cleanup.deleted, bytes: result.cleanup.deletedBytes },
    after: { objects: after.stats.objects, bytes: after.stats.bytes },
    skippedPlatforms: result.cleanup.skippedPlatforms,
  }));
} finally {
  if (cookie) await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
}
