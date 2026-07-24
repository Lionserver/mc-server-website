import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const title = `공지 자동 검증 ${suffix}`;
const detail = `점검 상세 안내 ${suffix}\n<script>globalThis.__announcementXss = true</script>`;
let cookie = "";
let announcementId = "";
let latestRevision = 0;

const adminFetch = (pathname, init = {}) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
});

const login = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "admin@minecraft.kr",
    password: "minecraft-admin-preview",
    otp: "000000",
  }),
});
assert.equal(login.status, 200, `admin login failed: ${await login.text()}`);
const sessionCookie = login.headers.get("set-cookie") ?? "";
cookie = sessionCookie.split(";")[0] ?? "";
assert.match(cookie, /^mkr_admin_session=/);

try {
  const now = Math.floor(Date.now() / 1000);
  const activePayload = {
    title,
    summary: "자동 검증 중인 점검 공지입니다.",
    detail,
    status: "published",
    startsAt: now - 60,
    endsAt: now + 600,
  };

  const crossSiteCreate = await fetch(`${baseUrl}/api/admin/announcements`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(activePayload),
  });
  assert.equal(crossSiteCreate.status, 403);

  const create = await adminFetch("/api/admin/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(activePayload),
  });
  const createText = await create.text();
  assert.equal(create.status, 201, `announcement create failed: ${createText}`);
  assert.equal(create.headers.get("cache-control"), "no-store");
  const created = JSON.parse(createText).announcement;
  announcementId = created.id;
  latestRevision = created.revision;
  assert.equal(latestRevision, 1);

  const publicActive = await fetch(`${baseUrl}/api/announcements`, { cache: "no-store" });
  assert.equal(publicActive.status, 200);
  assert.match(publicActive.headers.get("cache-control") ?? "", /s-maxage=15/);
  const publicActiveBody = await publicActive.json();
  const visible = publicActiveBody.announcements.find((entry) => entry.id === announcementId);
  assert.equal(visible.detail, detail);
  assert.equal(publicActiveBody.nextTransitionAt, activePayload.endsAt);
  const renderedActive = await fetch(baseUrl, { headers: { accept: "text/html" } });
  assert.equal(renderedActive.status, 200);
  const renderedActiveHtml = await renderedActive.text();
  assert.match(renderedActiveHtml, /site-announcement-banner/);
  assert.ok(renderedActiveHtml.includes(title));
  assert.equal(renderedActiveHtml.includes("<script>globalThis.__announcementXss = true</script>"), false);

  const overlap = await adminFetch("/api/admin/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...activePayload, title: `${title} 겹침` }),
  });
  assert.equal(overlap.status, 409);

  const missingOriginUpdate = await fetch(`${baseUrl}/api/admin/announcements/${announcementId}`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...activePayload, status: "draft", revision: latestRevision }),
  });
  assert.equal(missingOriginUpdate.status, 403);

  const draft = await adminFetch(`/api/admin/announcements/${announcementId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...activePayload, status: "draft", revision: latestRevision }),
  });
  assert.equal(draft.status, 200);
  latestRevision = (await draft.json()).announcement.revision;
  assert.equal(latestRevision, 2);

  const publicDraft = await fetch(`${baseUrl}/api/announcements`, { cache: "no-store" });
  assert.equal(publicDraft.status, 200);
  assert.equal((await publicDraft.json()).announcements.some((entry) => entry.id === announcementId), false);

  const stale = await adminFetch(`/api/admin/announcements/${announcementId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...activePayload, status: "draft", revision: 1 }),
  });
  assert.equal(stale.status, 409);

  const republish = await adminFetch(`/api/admin/announcements/${announcementId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...activePayload, revision: latestRevision }),
  });
  assert.equal(republish.status, 200);
  latestRevision = (await republish.json()).announcement.revision;
  assert.equal(latestRevision, 3);

  const missingOriginDelete = await fetch(`${baseUrl}/api/admin/announcements/${announcementId}`, {
    method: "DELETE",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ revision: latestRevision }),
  });
  assert.equal(missingOriginDelete.status, 403);

  const remove = await adminFetch(`/api/admin/announcements/${announcementId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: latestRevision }),
  });
  assert.equal(remove.status, 204);
  latestRevision += 1;

  const publicRemoved = await fetch(`${baseUrl}/api/announcements`, { cache: "no-store" });
  assert.equal(publicRemoved.status, 200);
  assert.equal((await publicRemoved.json()).announcements.some((entry) => entry.id === announcementId), false);

  const adminList = await adminFetch("/api/admin/announcements");
  assert.equal(adminList.status, 200);
  const archived = (await adminList.json()).announcements.find((entry) => entry.id === announcementId);
  assert.equal(archived.status, "archived");
  assert.equal(archived.revision, latestRevision);
  assert.ok(archived.deletedAt);

  const overview = await adminFetch("/api/admin/overview");
  assert.equal(overview.status, 200);
  const auditEntries = (await overview.json()).audits.filter((entry) => entry.target_id === announcementId);
  assert.ok(auditEntries.some((entry) => entry.action === "announcement.created"));
  assert.ok(auditEntries.some((entry) => entry.action === "announcement.published"));
  assert.ok(auditEntries.some((entry) => entry.action === "announcement.deleted"));
  const createdAudit = auditEntries.find((entry) => entry.action === "announcement.created");
  assert.equal(createdAudit.details.after.summarySha256, createHash("sha256").update(activePayload.summary).digest("hex"));
  assert.equal(createdAudit.details.after.detailSha256, createHash("sha256").update(detail).digest("hex"));
  assert.equal(JSON.stringify(createdAudit.details).includes(detail), false);

  const concurrentNow = Math.floor(Date.now() / 1000);
  const concurrentPayload = {
    ...activePayload,
    startsAt: concurrentNow + 30,
    endsAt: concurrentNow + 60,
  };
  const concurrentCreates = await Promise.all([
    adminFetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...concurrentPayload, title: `${title} 동시성 A` }),
    }),
    adminFetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...concurrentPayload, title: `${title} 동시성 B` }),
    }),
  ]);
  assert.deepEqual(concurrentCreates.map((response) => response.status).sort(), [201, 409]);
  const concurrentWinner = concurrentCreates.find((response) => response.status === 201);
  const concurrentAnnouncement = (await concurrentWinner.json()).announcement;
  announcementId = concurrentAnnouncement.id;
  latestRevision = concurrentAnnouncement.revision;

  const concurrentUpdates = await Promise.all([
    adminFetch(`/api/admin/announcements/${announcementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...concurrentPayload, title: `${title} 수정 A`, status: "draft", revision: latestRevision }),
    }),
    adminFetch(`/api/admin/announcements/${announcementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...concurrentPayload, title: `${title} 수정 B`, status: "draft", revision: latestRevision }),
    }),
  ]);
  assert.deepEqual(concurrentUpdates.map((response) => response.status).sort(), [200, 409]);
  const concurrentUpdateWinner = concurrentUpdates.find((response) => response.status === 200);
  latestRevision = (await concurrentUpdateWinner.json()).announcement.revision;
  assert.equal(latestRevision, 2);

  const concurrentRemove = await adminFetch(`/api/admin/announcements/${announcementId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: latestRevision }),
  });
  assert.equal(concurrentRemove.status, 204);
  const concurrentAudit = await adminFetch("/api/admin/overview").then((response) => response.json());
  const concurrentAuditEntries = concurrentAudit.audits.filter((entry) => entry.target_id === announcementId);
  assert.equal(concurrentAuditEntries.filter((entry) => entry.action === "announcement.created").length, 1);
  assert.equal(concurrentAuditEntries.filter((entry) => entry.action === "announcement.updated").length, 1);
  assert.equal(concurrentAuditEntries.filter((entry) => entry.action === "announcement.deleted").length, 1);

  const scheduledNow = Math.floor(Date.now() / 1000);
  const scheduledStartsAt = scheduledNow + 2;
  const scheduledEndsAt = scheduledNow + 5;
  const scheduledCreate = await adminFetch("/api/admin/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...activePayload,
      title: `${title} 예약 경계`,
      startsAt: scheduledStartsAt,
      endsAt: scheduledEndsAt,
    }),
  });
  assert.equal(scheduledCreate.status, 201);
  const scheduled = (await scheduledCreate.json()).announcement;
  announcementId = scheduled.id;
  latestRevision = scheduled.revision;

  const beforeStart = await fetch(`${baseUrl}/api/announcements`, { cache: "no-store" });
  assert.equal((await beforeStart.json()).announcements.some((entry) => entry.id === announcementId), false);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, scheduledStartsAt * 1000 - Date.now() + 250)));
  const afterStart = await fetch(`${baseUrl}/api/announcements`, { cache: "no-store" });
  assert.equal((await afterStart.json()).announcements.some((entry) => entry.id === announcementId), true);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, scheduledEndsAt * 1000 - Date.now() + 250)));
  const afterEnd = await fetch(`${baseUrl}/api/announcements`, { cache: "no-store" });
  assert.equal((await afterEnd.json()).announcements.some((entry) => entry.id === announcementId), false);

  const scheduledRemove = await adminFetch(`/api/admin/announcements/${announcementId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: latestRevision }),
  });
  assert.equal(scheduledRemove.status, 204);
  announcementId = "";
  console.log("site announcements smoke: passed");
} finally {
  if (announcementId) {
    const current = await adminFetch("/api/admin/announcements").then((response) => response.json()).catch(() => null);
    const entry = current?.announcements?.find((item) => item.id === announcementId);
    if (entry && entry.deletedAt == null) {
      await adminFetch(`/api/admin/announcements/${announcementId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: entry.revision }),
      }).catch(() => undefined);
    }
  }
  if (cookie) await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
}
