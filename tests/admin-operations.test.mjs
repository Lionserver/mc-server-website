import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const expectedPublicMutations = new Map([
  ["POST /api/bridge/provision", "bridge_provisioning"],
  ["POST /api/bridge/telemetry", "bridge_telemetry"],
  ["POST /api/bridge/verify", "bridge_provisioning"],
  ["POST /api/operator/channel", "messaging"],
  ["PATCH /api/ownership/claims/:claimId", "ownership"],
  ["POST /api/ownership/claims", "ownership"],
  ["PATCH /api/ownership/transfers/:transferId", "ownership"],
  ["POST /api/ownership/transfers", "ownership"],
  ["POST /api/premium/auction", "premium_bids"],
  ["POST /api/realtime/ticket", "messaging"],
  ["PATCH /api/servers/:serverId/assets", "media_uploads"],
  ["POST /api/servers/:serverId/assets", "media_uploads"],
  ["POST /api/servers/:serverId/bridge", "bridge_provisioning"],
  ["POST /api/servers/:serverId/bridge/verify", "bridge_provisioning"],
  ["DELETE /api/servers/:serverId/description-assets/:assetId", "media_uploads"],
  ["POST /api/servers/:serverId/description-assets", "media_uploads"],
  ["DELETE /api/servers/:serverId", "server_management"],
  ["PATCH /api/servers/:serverId", "server_management"],
  ["POST /api/servers/:serverId/votes", "votes"],
  ["POST /api/servers", "server_registration"],
  ["POST /api/support/threads/:serverId", "messaging"],
]);

test("inventories every non-exempt public mutation for the worker kill switch", async () => {
  const routeFiles = await findRouteFiles(path.join(root, "app", "api"));
  const actual = [];
  for (const file of routeFiles) {
    const source = await readFile(file, "utf8");
    const apiPath = routePath(file);
    if (isExemptPath(apiPath)) continue;
    for (const match of source.matchAll(/export async function (POST|PATCH|PUT|DELETE)\s*\(/g)) {
      actual.push(`${match[1]} ${apiPath}`);
    }
  }
  assert.deepEqual(actual.sort(), [...expectedPublicMutations.keys()].sort());

  const worker = await readFile(path.join(root, "worker", "index.ts"), "utf8");
  for (const featureKey of new Set(expectedPublicMutations.values())) {
    assert.match(worker, new RegExp(`return "${featureKey}"`));
  }
  assert.match(worker, /return "public_writes"/);
});

test("keeps recovery paths open and returns a structured temporary failure", async () => {
  const worker = await readFile(path.join(root, "worker", "index.ts"), "utf8");
  assert.match(worker, /pathAtOrBelow\(pathname, "\/api\/admin"\)/);
  assert.match(worker, /pathAtOrBelow\(pathname, "\/api\/auth"\)/);
  assert.match(worker, /pathAtOrBelow\(pathname, "\/api\/health"\)/);
  assert.match(worker, /pathAtOrBelow\(pathname, "\/api\/traffic"\)/);
  assert.match(worker, /FEATURE_TEMPORARILY_DISABLED/);
  assert.match(worker, /OPERATIONS_GUARD_UNAVAILABLE/);
  assert.match(worker, /status: 503/);
  assert.match(worker, /"Retry-After"/);
  assert.match(worker, /requestsAdminRealtimeTicket/);
});

test("persists feature controls, job heartbeat, checks, expiry and tracked scheduled jobs", async () => {
  const operations = await readFile(path.join(root, "lib", "admin-operations.ts"), "utf8");
  const worker = await readFile(path.join(root, "worker", "index.ts"), "utf8");
  for (const table of ["admin_feature_controls", "admin_job_statuses", "admin_operational_checks"]) {
    assert.match(operations, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(operations, /operations\.feature\.expired/);
  assert.match(operations, /last_started_at/);
  assert.match(operations, /last_succeeded_at/);
  assert.match(operations, /last_failed_at/);
  assert.match(operations, /failure_count = failure_count \+ 1/);
  assert.match(operations, /last_result NOT LIKE '\{"status":"running"%'/);
  assert.match(operations, /WHERE changes\(\) = 1/);
  assert.match(operations, /작업 실행 lease가 만료되거나 다른 실행으로 교체되었습니다/);
  for (const jobKey of [
    "public_status_snapshots",
    "application_retention_cleanup",
    "server_quarantine_purge",
    "broadcast_cache_cleanup",
  ]) {
    assert.match(worker, new RegExp(`runTrackedAdminJob\\(env\\.DB, "${jobKey}"`));
  }
  assert.match(worker, /Promise\.allSettled/);
});

test("exposes the agreed operations API request and response shapes", async () => {
  const route = await readFile(path.join(root, "app", "api", "admin", "operations", "route.ts"), "utf8");
  assert.match(route, /export async function GET/);
  assert.match(route, /operationsSnapshot/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /body\.type === "control"/);
  assert.match(route, /body\.type === "check"/);
  assert.match(route, /export async function POST/);
  assert.match(route, /body\.jobKey/);
  assert.match(route, /Response\.json\(\{ job, status:/);
  assert.match(route, /requireAdmin\(request, \{ mutating: true, stepUp: true \}\)/);
});

async function findRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findRouteFiles(target);
    return entry.isFile() && entry.name === "route.ts" ? [target] : [];
  }));
  return nested.flat();
}

function routePath(file) {
  const relative = path.relative(path.join(root, "app"), file).replaceAll(path.sep, "/");
  return `/${relative.replace(/\/route\.ts$/, "").replace(/\[([^\]]+)\]/g, ":$1")}`;
}

function isExemptPath(apiPath) {
  return ["/api/admin", "/api/auth", "/api/health", "/api/traffic"]
    .some((rootPath) => apiPath === rootPath || apiPath.startsWith(`${rootPath}/`));
}
