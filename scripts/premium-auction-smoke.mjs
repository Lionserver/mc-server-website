import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const ownerHeaders = { Origin: origin, "Content-Type": "application/json", "X-MKR-Local-Owner": "minecraft-kr-local-preview" };
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const title = `Auction smoke ${suffix}`;
const address = `auction-${suffix}.minecraft.kr`;
let cookie = "";
let serverId = "";
let bridgeId = "";
let auctionId = "";
let bidId = "";
let awardId = "";
let manualPlacementId = "";
let previousIdentity = null;

const d1Directory = new URL("../.wrangler/state/v3/d1/miniflare-D1DatabaseObject", import.meta.url).pathname;
const d1Files = (await readdir(d1Directory)).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
assert.equal(d1Files.length, 1, "로컬 D1 데이터베이스 파일을 하나만 찾을 수 있어야 합니다.");
const d1Path = join(d1Directory, d1Files[0]);
const openDb = () => new DatabaseSync(d1Path);

const adminFetch = (pathname, init = {}) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: { Origin: origin, Cookie: cookie, ...(init.headers ?? {}) },
});

const login = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json", "User-Agent": `auction-smoke-${suffix}` },
  body: JSON.stringify({ email: "admin@minecraft.kr", password: "minecraft-admin-preview", otp: "000000" }),
});
assert.equal(login.status, 200);
cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

try {
  const create = await fetch(`${baseUrl}/api/servers`, {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      title,
      shortDescription: "프리미엄 주간 경매 자동 검증 서버",
      description: "소유권 인증, 입찰 인상, 낙찰, 결제 확인과 프리미엄 예약 흐름을 검증하는 서버입니다.",
      edition: "JE", minVersion: "1.20.4", maxVersion: "1.21.8", address, port: 25565, categories: ["야생"],
    }),
  });
  assert.equal(create.status, 201);
  serverId = (await create.json()).server.id;

  const provision = await fetch(`${baseUrl}/api/servers/${serverId}/bridge`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ platform: "paper" }),
  });
  assert.equal(provision.status, 201);
  bridgeId = (await provision.json()).bridge.serverId;

  const db = openDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("UPDATE bridge_servers SET verified_at = ?, last_seen_at = ? WHERE server_id = ?").run(now, now, bridgeId);
  db.prepare("UPDATE directory_servers SET status = 'active', owner_verification_status = 'verified', owner_verified_at = ?, updated_at = ? WHERE id = ?").run(now, now, serverId);
  previousIdentity = db.prepare(`SELECT identity_verification_status, identity_verified_at, identity_provider, identity_reference
    FROM user_accounts WHERE email = 'owner@minecraft.kr'`).get() ?? null;
  if (previousIdentity) {
    db.prepare(`UPDATE user_accounts SET identity_verification_status = 'unverified', identity_verified_at = NULL,
      identity_provider = '', identity_reference = '', updated_at = ? WHERE email = 'owner@minecraft.kr'`).run(now);
  }
  db.close();

  const identityGateResponse = await fetch(`${baseUrl}/api/premium/auction?serverId=${serverId}`, { headers: ownerHeaders });
  assert.equal(identityGateResponse.status, 200);
  assert.equal((await identityGateResponse.json()).eligible, false, "본인인증 전에는 입찰이 차단되어야 합니다.");
  const identityDb = openDb();
  identityDb.prepare(`INSERT INTO user_accounts
    (id, email, email_verified_at, last_login_at, created_at, updated_at, identity_verification_status,
      identity_verified_at, identity_provider, identity_reference)
    VALUES (?, 'owner@minecraft.kr', ?, ?, ?, ?, 'verified', ?, 'smoke', ?)
    ON CONFLICT(email) DO UPDATE SET identity_verification_status = 'verified', identity_verified_at = excluded.identity_verified_at,
      identity_provider = excluded.identity_provider, identity_reference = excluded.identity_reference, updated_at = excluded.updated_at`)
    .run(crypto.randomUUID().replaceAll("-", ""), now, now, now, now, now, `smoke-${suffix}`);
  identityDb.close();

  const dashboardResponse = await fetch(`${baseUrl}/api/premium/auction?serverId=${serverId}`, { headers: ownerHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.eligible, true);
  assert.equal(dashboard.auction.status, "open");
  auctionId = dashboard.auction.id;
  const amount = dashboard.auction.minimumBid + dashboard.auction.minimumIncrement;

  const noOrigin = await fetch(`${baseUrl}/api/premium/auction`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-MKR-Local-Owner": "minecraft-kr-local-preview" },
    body: JSON.stringify({ auctionId, serverId, amount, acceptedTerms: true }),
  });
  assert.equal(noOrigin.status, 403);

  const bid = await fetch(`${baseUrl}/api/premium/auction`, {
    method: "POST",
    headers: { ...ownerHeaders, Origin: origin },
    body: JSON.stringify({ auctionId, serverId, amount, acceptedTerms: true }),
  });
  assert.equal(bid.status, 201);
  const bidDashboard = await bid.json();
  bidId = bidDashboard.ownBid.id;
  assert.equal(bidDashboard.ownBid.amount, amount);
  assert.equal(bidDashboard.leaderboard.some((entry) => entry.serverId === serverId && entry.mine), true);

  const lowerBid = await fetch(`${baseUrl}/api/premium/auction`, {
    method: "POST",
    headers: { ...ownerHeaders, Origin: origin },
    body: JSON.stringify({ auctionId, serverId, amount, acceptedTerms: true }),
  });
  assert.equal(lowerBid.status, 400);

  const finalize = await adminFetch(`/api/admin/auctions/${auctionId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finalize_now", confirmation: auctionId }),
  });
  assert.equal(finalize.status, 200);
  const finalized = await finalize.json();
  assert.equal(finalized.current.status, "closed");
  assert.equal(finalized.awards.length, 1);
  assert.equal(finalized.awards[0].status, "payment_pending");
  awardId = finalized.awards[0].id;

  const confirm = await adminFetch(`/api/admin/auctions/${auctionId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm_payment", awardId, paymentReference: `transfer-${suffix}` }),
  });
  assert.equal(confirm.status, 200);
  const confirmed = await confirm.json();
  assert.ok(["scheduled", "active"].includes(confirmed.awards[0].status));
  assert.equal(confirmed.awards[0].paymentReference, `transfer-${suffix}`);
  const auctionPlacement = confirmed.placements.find((placement) => placement.awardId === awardId);
  assert.equal(auctionPlacement.source, "auction");
  assert.equal(auctionPlacement.serverTitle, title, "광고 이력에는 당시 서버명이 저장되어야 합니다.");

  const manualFill = await adminFetch(`/api/admin/auctions/${auctionId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "fill_current_slot", serverId, note: `vacancy-${suffix}` }),
  });
  assert.equal(manualFill.status, 200);
  const manuallyFilled = await manualFill.json();
  const manualPlacement = manuallyFilled.placements.find((placement) => placement.source === "manual_fill" && placement.serverId === serverId);
  assert.ok(manualPlacement);
  manualPlacementId = manualPlacement.id;
  assert.equal(manualPlacement.status, "active");
  assert.equal(manualPlacement.endsAt, dashboard.auction.targetStartsAt, "수동 빈 슬롯은 다음 광고 주간 시작 때 자동 종료되어야 합니다.");

  const cancelManual = await adminFetch(`/api/admin/auctions/${auctionId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel_manual_placement", placementId: manualPlacementId }),
  });
  assert.equal(cancelManual.status, 200);
  const cancelledManual = await cancelManual.json();
  assert.equal(cancelledManual.placements.find((placement) => placement.id === manualPlacementId).status, "cancelled");

  const verifyDb = openDb();
  const premium = verifyDb.prepare("SELECT premium_managed, premium_tier, premium_starts_at, premium_ends_at FROM directory_servers WHERE id = ?").get(serverId);
  verifyDb.close();
  assert.equal(premium.premium_managed, 1);
  assert.equal(premium.premium_tier, "premium");
  assert.equal(premium.premium_starts_at, dashboard.auction.targetStartsAt);
  assert.equal(premium.premium_ends_at, dashboard.auction.targetEndsAt);

  console.log("premium auction smoke: passed");
} finally {
  const cleanup = openDb();
  if (auctionId) {
    cleanup.prepare("DELETE FROM premium_placements WHERE auction_id = ? OR server_id = ?").run(auctionId, serverId);
    cleanup.prepare("DELETE FROM premium_awards WHERE auction_id = ?").run(auctionId);
    cleanup.prepare("DELETE FROM premium_bids WHERE auction_id = ?").run(auctionId);
    cleanup.prepare("DELETE FROM premium_auctions WHERE id = ?").run(auctionId);
  }
  if (bridgeId) {
    cleanup.prepare("DELETE FROM bridge_backends WHERE server_id = ?").run(bridgeId);
    cleanup.prepare("DELETE FROM bridge_nonces WHERE server_id = ?").run(bridgeId);
    cleanup.prepare("DELETE FROM bridge_servers WHERE server_id = ?").run(bridgeId);
  }
  if (serverId) {
    cleanup.prepare("DELETE FROM server_assets WHERE server_id = ?").run(serverId);
    cleanup.prepare("DELETE FROM directory_servers WHERE id = ?").run(serverId);
  }
  for (const targetId of [auctionId, bidId, awardId, serverId].filter(Boolean)) {
    cleanup.prepare("DELETE FROM admin_audit_logs WHERE target_id = ? OR details LIKE ?").run(targetId, `%${targetId}%`);
  }
  if (previousIdentity) {
    cleanup.prepare(`UPDATE user_accounts SET identity_verification_status = ?, identity_verified_at = ?,
      identity_provider = ?, identity_reference = ?, updated_at = ? WHERE email = 'owner@minecraft.kr'`)
      .run(previousIdentity.identity_verification_status, previousIdentity.identity_verified_at,
        previousIdentity.identity_provider, previousIdentity.identity_reference, Math.floor(Date.now() / 1000));
  } else {
    cleanup.prepare("DELETE FROM user_accounts WHERE email = 'owner@minecraft.kr'").run();
  }
  cleanup.close();
  if (cookie) await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
}
