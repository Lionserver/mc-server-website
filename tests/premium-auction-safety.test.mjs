import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const premiumSource = await readFile(new URL("../lib/premium-auction.ts", import.meta.url), "utf8");
const accountRoute = await readFile(new URL("../app/api/admin/accounts/[accountId]/route.ts", import.meta.url), "utf8");
const identityRoute = await readFile(new URL("../app/api/admin/identity/[accountId]/route.ts", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = premiumSource.indexOf(`export async function ${name}`);
  const end = premiumSource.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} source must exist`);
  assert.notEqual(end, -1, `${nextName} source must exist after ${name}`);
  return premiumSource.slice(start, end);
}

test("premium bid mutations recheck current auction, server, bridge, and account eligibility atomically", () => {
  const source = functionSource("placePremiumBid", "fillCurrentPremiumVacancy");
  assert.match(source, /UPDATE premium_bids[\s\S]*auction\.status = 'open'/);
  assert.match(source, /auction\.bidding_opens_at <= \? AND auction\.bidding_closes_at > \?/);
  assert.match(source, /server\.deleted_at IS NULL AND server\.status = 'active'/);
  assert.match(source, /server\.owner_verification_status = 'verified'/);
  assert.match(source, /bridge\.verified_at IS NOT NULL/);
  assert.match(source, /account\.account_status = 'active'/);
  assert.match(source, /account\.identity_verification_status = 'verified'/);
  assert.match(source, /INSERT INTO premium_bids[\s\S]*SELECT \?, auction\.id, server\.id/);
  assert.match(source, /prepareAuditWrite\(db, ownerEmail, "premium\.bid\.raised"/);
  assert.match(source, /prepareAuditWrite\(db, ownerEmail, "premium\.bid\.placed"/);
  assert.match(source, /onlyIfPreviousStatementChanged: true/);
  assert.match(source, /isUniqueConstraintError/);
  assert.doesNotMatch(source, /await writeAudit\(db, ownerEmail, "premium\.bid/);
});

test("finalization and replacement promotion cannot revive cancelled or ineligible bids", () => {
  const finalize = functionSource("finalizePremiumAuction", "confirmPremiumAward");
  const forfeit = functionSource("forfeitPremiumAward", "cancelPremiumAuction");
  assert.match(finalize, /WHERE id = \? AND auction_id = \? AND status = 'active'/);
  assert.match(finalize, /account\.account_status = 'active'/);
  assert.match(finalize, /FROM premium_bids WHERE id = \?[\s\S]*changes\(\) = 1/);
  assert.match(forfeit, /WHERE id = \? AND auction_id = \? AND status = 'loser'[\s\S]*AND EXISTS/);
  assert.match(forfeit, /account\.account_status = 'active'/);
  assert.match(forfeit, /promoted\.status = 'winner_pending'[\s\S]*changes\(\) = 1|changes\(\) = 1[\s\S]*promoted\.status = 'winner_pending'/);
});

test("account and identity suspension remove premium financial locks without automatic restoration", () => {
  assert.match(accountRoute, /status = 'cancelled_account'[\s\S]*status IN \('active', 'winner_pending'\)/);
  assert.match(accountRoute, /status = 'account_suspended'[\s\S]*status IN \('payment_pending', 'scheduled', 'active'\)/);
  assert.match(accountRoute, /UPDATE premium_placements SET status = 'account_suspended'/);
  assert.match(accountRoute, /premium_managed = 0, premium_tier = 'none'/);
  assert.doesNotMatch(accountRoute, /action === "restore"[\s\S]*UPDATE premium_bids SET status = 'active'/);
  assert.match(identityRoute, /status IN \('active', 'winner_pending'\)/);
});

test("manual and scheduled placements enforce live account and server eligibility at mutation time", () => {
  const manual = functionSource("fillCurrentPremiumVacancy", "cancelManualPremiumPlacement");
  const syncStart = premiumSource.indexOf("async function synchronizePremiumPlacements");
  const syncEnd = premiumSource.indexOf("async function currentPlacementWindow", syncStart);
  const synchronization = premiumSource.slice(syncStart, syncEnd);
  assert.match(manual, /INSERT INTO premium_placements[\s\S]*FROM directory_servers server/);
  assert.match(manual, /JOIN bridge_servers bridge/);
  assert.match(manual, /account\.account_status = 'active'/);
  assert.match(manual, /account\.identity_verification_status = 'verified'/);
  assert.match(synchronization, /SET status = 'account_suspended'/);
  assert.match(synchronization, /account\.account_status = 'active'/);
  assert.match(synchronization, /server\.owner_verification_status = 'verified'/);
});
