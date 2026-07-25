import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_TEMPORARY_ADMIN_ACCESS_SECONDS, temporaryAdminSession } from "../lib/admin-temporary-access.mjs";
import { resolveThemePreference, safeInternalReturnTo } from "../lib/browser-preferences.mjs";
import { isPrivateHostName, isPrivateOrReservedIp, networkFingerprintAddress, normalizeIpAddress } from "../lib/ip-security.mjs";
import { announcementPhase, nextAnnouncementTransition } from "../lib/site-announcement-lifecycle.mjs";
import { isAdminPasswordHash, isTotpSecret, verifyAdminPassword, verifyTotpCode } from "../lib/admin-credentials.mjs";

async function readHomeSource() {
  const [pageSource, directorySource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/home-directory.tsx", import.meta.url), "utf8"),
  ]);
  return `${pageSource}\n${directorySource}`;
}

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("production administrator credential primitives reject malformed values and verify valid credentials", async () => {
  const passwordHash = "hmac-sha256$1$MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY$3mKOEcbSna_CyhbX8wXvIc3279dNWnlGBHUMyUU2AVU";
  assert.equal(isAdminPasswordHash(passwordHash), true);
  assert.equal(isAdminPasswordHash(`"${passwordHash}"`), false);
  assert.equal(await verifyAdminPassword("minecraft-admin-test-password", passwordHash), true);
  assert.equal(await verifyAdminPassword("incorrect-password", passwordHash), false);

  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(isTotpSecret(rfcSecret), true);
  assert.equal(isTotpSecret(`"${rfcSecret}"`), false);
  assert.equal(await verifyTotpCode("287082", rfcSecret, 59_000), true);
  assert.equal(await verifyTotpCode("000000", rfcSecret, 59_000), false);
});

test("server-renders the Minecraft.kr product shell", async () => {
  const [pageSource, headerSource] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../components/public-site-header.tsx", import.meta.url), "utf8"),
  ]);
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>Minecraft\.kr — 한국 마인크래프트 서버리스트<\/title>/i);
  assert.match(html, /한국 마인크래프트/);
  assert.match(html, /서버리스트/);
  assert.match(html, /KOREA SERVER INDEX/);
  assert.match(html, /실시간 서버 리스트/);
  assert.match(html, /등록·인증된 서버만 표시합니다/);
  assert.match(html, /계정 확인/);
  assert.match(html, /운영자 센터/);
  assert.match(html, /og:image/);
  assert.match(html, /https?:\/\/[^"]+\/og\.png/);
  assert.match(headerSource, /className="brand header-brand"[^\n]*MINECRAFT SERVER LIST/);
  assert.doesNotMatch(headerSource, /className="brand header-brand"[^\n]*brand-mark/);
  assert.doesNotMatch(pageSource, /실제 추천 기록 기준 · PC·모바일 공용 GIF·WebM 468×60/);
  assert.doesNotMatch(pageSource, /프리미엄 노출과 일반 추천 순위를 분리해 표시합니다/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships a measured small-community server directory", async () => {
  const [page, directory, css] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /소규모 서버/);
  assert.match(page, /SMALL COMMUNITY INDEX/);
  assert.match(page, /server\.averagePlayers7d !== null && server\.averagePlayers7d < 20/);
  assert.match(page, /7일 평균 동접/);
  assert.match(page, /상태 이력 없는 서버 제외/);
  assert.match(directory, /averagePlayers7d: row\.recent_average == null \? null/);
  assert.match(directory, /AVG\(h\.players\).*recent_average/);
  assert.match(css, /\.small-directory-hero/);
  assert.match(css, /\.small-directory-copy p \{ max-width:none;/);
  assert.match(css, /\.small-server-row/);
});

test("ships a privacy-preserving KST daily visitor count in the directory status bar", async () => {
  const [page, provider, traffic, route, layout, health, maintenance, schema, migration, totalsMigration, privacy, css, envExample] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../components/site-traffic-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/site-traffic.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/traffic/today/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/maintenance.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0024_slow_swarm.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0025_sour_zzzax.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(page, /오늘 방문자/);
  assert.match(page, /한국시간 기준 · 동일 네트워크는 하루 한 번 집계/);
  assert.match(page, /useSiteTraffic/);
  assert.match(provider, /document\.visibilityState === "visible"/);
  assert.match(provider, /fetch\("\/api\/traffic\/today"/);
  assert.match(provider, /millisecondsUntilNextKstDay/);
  assert.match(provider, /requestedDay\.current === day/);
  assert.match(traffic, /KST_OFFSET_SECONDS = 9 \* 60 \* 60/);
  assert.match(traffic, /INSERT OR IGNORE INTO site_daily_visitors/);
  assert.match(traffic, /SELECT visitor_count count FROM site_daily_visitor_totals/);
  assert.doesNotMatch(traffic, /SELECT COUNT\(\*\) count FROM site_daily_visitors/);
  assert.match(traffic, /HMAC/);
  assert.match(traffic, /process\.env\.NODE_ENV === "production"/);
  assert.match(traffic, /request\.headers\.get\("cf-connecting-ip"\)/);
  assert.match(traffic, /new TextEncoder\(\)\.encode\(`\$\{day\}\\n\$\{network\}`\)/);
  assert.doesNotMatch(traffic, /raw_address|source_ip_raw/i);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(layout, /<SiteTrafficProvider>/);
  assert.match(health, /siteTrafficPrivacySecret/);
  assert.match(maintenance, /trafficRetentionBoundary/);
  assert.match(schema, /siteDailyVisitors/);
  assert.match(schema, /siteDailyVisitorTotals/);
  assert.match(migration, /PRIMARY KEY\(`visit_day`, `visitor_hash`\)/);
  assert.match(totalsMigration, /CREATE TRIGGER `site_daily_visitors_increment_total`/);
  assert.match(totalsMigration, /ON CONFLICT\(`visit_day`\) DO UPDATE/);
  assert.match(privacy, /일일 방문 대조값은 최대 3일/);
  assert.match(privacy, /OpenAI OpCo, LLC \(ChatGPT Sites\)/);
  assert.match(css, /\.today-visitor-stat \{ margin-left:auto/);
  assert.match(envExample, /SITE_TRAFFIC_HASH_SECRET/);
});

test("ships a seven-day newly registered server directory", async () => {
  const [page, directory, css] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /신규 서버/);
  assert.match(page, /NEW SERVER ARRIVALS/);
  assert.match(page, /NEW_SERVER_WINDOW_SECONDS = 7 \* 86_400/);
  assert.match(page, /server\.createdAt >= directoryUpdatedAt - NEW_SERVER_WINDOW_SECONDS/);
  assert.match(page, /requestedView === "small" \|\| requestedView === "new"/);
  assert.match(page, /b\.createdAt - a\.createdAt/);
  assert.match(page, /최근 7일 이내 등록된 서버가 없습니다/);
  assert.match(directory, /createdAt: row\.created_at/);
  assert.match(css, /\.main-nav \.new-directory-link/);
  assert.match(page, /new-directory-hero/);
});

test("keeps featured directory result shells vertically aligned", async () => {
  const [page, css] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /small-server-group featured-server-group/);
  assert.match(page, /server-group new-server-group featured-server-group/);
  assert.match(css, /\.featured-directory-results \{ min-height:156px;/);
  assert.match(css, /\.featured-directory-results > \.featured-server-group \{ margin-bottom:0;/);
  assert.match(css, /\.featured-server-group > \.empty-state \{ min-height:122px;/);
  assert.match(css, /\.featured-directory-results \{ min-height:295px;/);
  assert.match(css, /\.featured-server-group > \.empty-state,\.featured-server-group > \.server-row,\.featured-server-group > \.small-server-row \{ min-height:261px;/);
});

test("server-renders the owner console shell", async () => {
  const response = await render("/operator");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /이메일 계정을 확인하는 중/);
});

test("ships repeatable, owner-triggered MOTD verification", async () => {
  const [operator, provisionRoute, verifyRoute, minecraftPing, css] = await Promise.all([
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/bridge/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/bridge/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/minecraft-ping.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(operator, /인증 정보 다시 발급/);
  assert.match(operator, /지금 인증하기/);
  assert.match(operator, /게임 포트 응답을 5초 동안 기다립니다/);
  assert.match(operator, /Cloudflare 주황색 프록시/);
  assert.match(operator, /Minecraft SRV 레코드/);
  assert.match(operator, /verifyOwnershipNow/);
  assert.match(operator, /bridge\/verify/);
  assert.doesNotMatch(operator, /selected\.bridgeServerId \? "이미 발급됨"/);
  assert.match(provisionRoute, /UPDATE bridge_servers SET platform/);
  assert.match(provisionRoute, /reissued: Boolean\(existingBridge\)/);
  assert.match(provisionRoute, /export async function GET/);
  assert.match(provisionRoute, /verified: Boolean\(bridge\.verified_at\)/);
  assert.match(provisionRoute, /deriveBridgeSecret\(bridge\.server_id\)/);
  assert.doesNotMatch(provisionRoute, /bridge verification is already provisioned/);
  assert.match(verifyRoute, /ownerEmailFromRequest/);
  assert.match(verifyRoute, /assertSameOrigin/);
  assert.match(verifyRoute, /pingMinecraftServer/);
  assert.match(verifyRoute, /MKR-VERIFY/);
  assert.match(verifyRoute, /owner_verification_status = 'verified'/);
  assert.match(minecraftPing, /MINECRAFT_PING_TIMEOUT/);
  assert.match(minecraftPing, /}, 5_000\)/);
  assert.match(minecraftPing, /_minecraft\._tcp/);
  assert.match(minecraftPing, /type=SRV/);
  assert.match(minecraftPing, /usedSrv: true/);
  assert.match(css, /\.verification-steps/);
  assert.match(css, /\.verification-action button/);
});

test("ships downloadable Paper/Folia and Velocity bridge plugins", async () => {
  const [operator, paperJar, velocityJar, checksums, pluginYml, paperSource, velocitySource] = await Promise.all([
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/downloads/minecraft-kr-paper-bridge-1.0.1.jar", import.meta.url)),
    readFile(new URL("../public/downloads/minecraft-kr-velocity-bridge-1.0.1.jar", import.meta.url)),
    readFile(new URL("../public/downloads/SHA256SUMS", import.meta.url), "utf8"),
    readFile(new URL("../minecraft-bridge/paper/src/main/resources/plugin.yml", import.meta.url), "utf8"),
    readFile(new URL("../minecraft-bridge/paper/src/main/java/kr/minecraft/bridge/paper/MinecraftKrPaperBridge.java", import.meta.url), "utf8"),
    readFile(new URL("../minecraft-bridge/velocity/src/main/java/kr/minecraft/bridge/velocity/MinecraftKrVelocityBridge.java", import.meta.url), "utf8"),
  ]);
  assert.equal(paperJar.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(velocityJar.subarray(0, 2).toString("ascii"), "PK");
  assert.match(checksums, new RegExp(createHash("sha256").update(paperJar).digest("hex")));
  assert.match(checksums, new RegExp(createHash("sha256").update(velocityJar).digest("hex")));
  assert.match(operator, /MINECRAFT\.KR BRIDGE/);
  assert.match(operator, /minecraft-kr-paper-bridge-1\.0\.1\.jar/);
  assert.match(operator, /minecraft-kr-velocity-bridge-1\.0\.1\.jar/);
  assert.match(operator, /config\.properties/);
  assert.match(operator, /bridgeConfigText/);
  assert.match(operator, /이 서버 연결 설정 열기/);
  assert.match(operator, /loadBridgeConnection/);
  assert.match(operator, /exposeVerificationToken=\$\{bridge\.verified/);
  assert.match(pluginYml, /folia-supported: true/);
  assert.match(pluginYml, /version: 1\.0\.1/);
  assert.match(paperSource, /isFolia\(\)/);
  assert.match(paperSource, /getAsyncScheduler/);
  assert.match(velocitySource, /version = "1\.0\.1"/);
});

test("keeps verified servers online through cached public Minecraft status pings", async () => {
  const [page, directory, bridgeApi, ownerVerify, pluginVerify, schema, migration] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/bridge-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/bridge/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bridge/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_robust_wrecker.sql", import.meta.url), "utf8"),
  ]);
  assert.match(directory, /refreshPublicStatusSnapshots/);
  assert.match(directory, /pingMinecraftServer\(candidate\.address, candidate\.port\)/);
  assert.match(directory, /last_ping_success_at/);
  assert.match(directory, /bridgeOnline \|\| pingOnline/);
  assert.match(directory, /statusSource/);
  assert.match(page, /공개 핑 연결/);
  assert.match(page, /브리지 실시간 연결/);
  assert.match(bridgeApi, /ALTER TABLE bridge_servers ADD COLUMN last_ping_success_at/);
  assert.match(ownerVerify, /ping_players = \?/);
  assert.match(pluginVerify, /ping_players = \?/);
  assert.match(schema, /lastPingSuccessAt: integer\("last_ping_success_at"\)/);
  assert.match(migration, /ADD `last_ping_success_at`/);
});

test("ships owner-controlled contact links, web trend monitoring, bridge disclosure and save feedback", async () => {
  const [page, operator, directory, serverRoute, telemetryRoute, worker, vite, schema, migration, css] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bridge/telemetry/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0011_omniscient_speed.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(operator, /ServerLinkEditor/);
  assert.match(operator, /Discord 아이디 또는 링크/);
  assert.match(operator, /type="text" value=\{member\.discordUrl\}/);
  assert.match(operator, /server-link-grid/);
  assert.match(operator, /operator-save-toast/);
  assert.match(operator, /변경사항 저장 완료/);
  assert.match(page, /detail-online-status/);
  assert.match(page, /브리지 미연결 서버/);
  assert.match(page, /vote-modal/);
  assert.match(page, /닉네임으로 추천 등록/);
  assert.match(page, /kakaoEnabled/);
  assert.match(page, /StaffDiscordContact/);
  assert.match(page, /Discord 아이디를 복사했습니다/);
  assert.match(page, /5분 원본 기록을 그대로 표시/);
  assert.match(page, /if \(selectedIdRef\.current\) void refreshSelected/);
  assert.match(page, /5분 원본 \{formatPlayers\(chartPoints\.length\)\}개/);
  assert.match(directory, /server_status_history/);
  assert.match(directory, /SELECT bucket_at, players, max_players, source/);
  assert.doesNotMatch(directory, /GROUP BY day ORDER BY day ASC/);
  assert.match(directory, /운영진 개인 Discord 아이디 또는 링크/);
  assert.match(directory, /source: "bridge" \| "ping" \| "mixed"/);
  assert.match(serverRoute, /kakao_enabled = \?/);
  assert.match(telemetryRoute, /source = 'bridge'/);
  assert.match(worker, /scheduled\(_controller: ScheduledController/);
  assert.match(worker, /collectPublicStatusSnapshots/);
  assert.match(vite, /\*\/5 \* \* \* \*/);
  assert.match(directory, /STATUS_BUCKET_SECONDS = 5 \* 60/);
  assert.match(directory, /mode: "interactive" \| "scheduled"/);
  assert.match(directory, /NOT EXISTS \(SELECT 1 FROM server_status_history current/);
  assert.match(directory, /MAX_SCHEDULED_STATUS_BATCHES/);
  assert.match(directory, /refreshPublicStatusSnapshots\(db, now, undefined, "scheduled"\)/);
  assert.match(schema, /serverStatusHistory/);
  assert.match(migration, /CREATE TABLE `server_status_history`/);
  assert.match(migration, /ADD `kakao_enabled`/);
  assert.match(css, /\.detail-status-strip/);
  assert.match(css, /\.operator-save-toast/);
});

test("server-renders the protected administrator shell", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /총관리자 보안 세션 확인 중/);
});

test("retires the temporary administrator header bypass fail-closed", async () => {
  const now = 1_800_000_000;
  const expiresAt = now + MAX_TEMPORARY_ADMIN_ACCESS_SECONDS;
  assert.equal(MAX_TEMPORARY_ADMIN_ACCESS_SECONDS, 0);
  assert.equal(temporaryAdminSession(null, "Owner@Example.com", String(expiresAt), now), null);
  assert.equal(temporaryAdminSession("owner@example.com", "Owner@Example.com", String(expiresAt), now), null);
  assert.equal(temporaryAdminSession("other@example.com", "owner@example.com", String(expiresAt), now), null);

  const [security, sessionRoute, worker, envExample, devVarsExample] = await Promise.all([
    readFile(new URL("../lib/admin-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.dev.vars.example", import.meta.url), "utf8"),
  ]);
  assert.match(security, /if \(options\?\.mutating \|\| options\?\.stepUp\) assertSameOrigin\(request\)/);
  assert.doesNotMatch(security, /temporaryAdminSession/);
  assert.doesNotMatch(security, /temporary: true/);
  assert.match(sessionRoute, /authMode: session\.authMode/);
  assert.match(sessionRoute, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(sessionRoute, /admin\.temporary_access/);
  assert.match(worker, /headers\.delete\("OAI-Authenticated-User-Email"\)/);
  assert.match(worker, /resolveOwnerSessionEmail\(env\.DB, request\)/);
  assert.match(await readFile(new URL("../lib/user-auth.ts", import.meta.url), "utf8"), /trustedPlatformUserEmail/);
  assert.doesNotMatch(envExample, /ADMIN_TEMP_BYPASS_/);
  assert.doesNotMatch(devVarsExample, /ADMIN_TEMP_BYPASS_/);
});

test("rejects private and reserved socket targets and canonicalizes abuse-control addresses", async () => {
  for (const address of [
    "0.0.0.0", "10.20.30.40", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.168.1.1", "192.0.2.10", "198.51.100.2", "203.0.113.4", "224.0.0.1",
    "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::",
  ]) assert.equal(isPrivateOrReservedIp(address), true, address);
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
  assert.equal(isPrivateHostName("metadata.internal"), true);
  assert.equal(isPrivateHostName("host.local"), true);
  assert.equal(normalizeIpAddress("2001:0DB8::0001"), "2001:db8:0:0:0:0:0:1");
  assert.equal(networkFingerprintAddress("2606:4700:4700:0:abcd::1"), "2606:4700:4700:0::/64");

  const [ping, guards, ownership, voteSource, chatRoom, worker, schema, migration] = await Promise.all([
    readFile(new URL("../lib/minecraft-ping.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/request-guards.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-ownership.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/vote-source.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/chat-room.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0023_wide_bulldozer.sql", import.meta.url), "utf8"),
  ]);
  assert.match(ping, /resolvePublicHostAddress/);
  assert.match(ping, /hostname: connectHost/);
  assert.match(ping, /allowPrivate && process\.env\.NODE_ENV === "development"/);
  assert.match(ping, /Promise\.allSettled/);
  assert.match(guards, /PROFILE_LOOKUPS_PER_MINUTE/);
  assert.match(guards, /SERVER_QUOTA_PER_OWNER/);
  assert.match(guards, /OWNER_STORAGE_BYTES/);
  assert.doesNotMatch(ownership, /SELECT c\.\*, d\.title, d\.address, d\.port, d\.owner_email FROM server_ownership_claims c[\s\S]{0,240}claimant_email/);
  assert.match(ownership, /includeCurrentOwnerEmail \? \{ currentOwnerEmail:/);
  assert.match(voteSource, /vote-source-fingerprint-v2/);
  assert.doesNotMatch(voteSource, /LOCAL_HASH_SECRET/);
  assert.match(chatRoom, /authorization refresh required/);
  assert.match(chatRoom, /setAlarm/);
  assert.match(worker, /realtime authorization changed/);
  assert.match(schema, /securityRateLimits/);
  assert.match(migration, /CREATE TABLE `security_rate_limits`/);
});

test("ships expiring server enforcement controls and formatted auction bids", async () => {
  const [admin, operator, security, overview, createRoute, revokeRoute, publicDirectory, schema, migration, css] = await Promise.all([
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/enforcements/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/enforcements/[enforcementId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0017_red_wonder_man.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /서버 경고·차단·블라인드/);
  assert.match(admin, /날짜 직접 지정/);
  assert.match(admin, /현재 적용 중인 서버/);
  assert.match(operator, /operator-enforcement-notices/);
  assert.match(operator, /formatMoneyInput\(amount\)/);
  assert.match(operator, /inputMode="numeric"/);
  assert.match(security, /synchronizeServerEnforcements/);
  assert.match(security, /status = 'expired'/);
  assert.match(security, /status = 'blinded'/);
  assert.match(security, /status = 'suspended'/);
  assert.match(overview, /server_enforcements/);
  assert.match(createRoute, /server\.enforcement\.\$\{kind\}\.created/);
  assert.match(revokeRoute, /status = 'revoked'/);
  assert.match(publicDirectory, /synchronizeServerEnforcements/);
  assert.match(schema, /serverEnforcements/);
  assert.match(migration, /CREATE TABLE `server_enforcements`/);
  assert.match(migration, /ADD `status_before_enforcement`/);
  assert.match(css, /\.admin-enforcement-active-grid/);
  assert.match(css, /\.auction-money-preview/);
});

test("ships a structured server-introduction editor with safe poster uploads", async () => {
  const [editor, registration, operator, page, description, serverRoute, createRoute, posterRoute, posterServe, imageAssets, schema, migration, css, ticketRoute, worker, readme] = await Promise.all([
    readFile(new URL("../components/server-description-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-registration-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readHomeSource(),
    readFile(new URL("../lib/server-description.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/description-assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/description-assets/[assetId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/image-assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0018_solid_valkyrie.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/embed/server/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /FULL WYSIWYG EDITOR/);
  assert.match(editor, /HTML 소스 편집 차단/);
  assert.match(editor, /useEditor/);
  assert.match(editor, /toggleBulletList/);
  assert.match(editor, /setHorizontalRule/);
  assert.match(editor, /getData\("text\/plain"\)/);
  assert.match(editor, /descriptionPoster/);
  assert.match(editor, /ReactNodeViewRenderer\(DescriptionPosterView\)/);
  assert.match(editor, /data-drag-handle/);
  assert.match(editor, /draggable=\{false\}/);
  assert.match(editor, /if \(moved\) return false/);
  assert.match(editor, /편집기에서 접기/);
  assert.match(editor, /사진은 저장·공개 상태 그대로 유지됩니다/);
  assert.match(editor, /<button type="button" className="editor-image-button"/);
  assert.match(editor, /onClick=\{\(\) => fileRef\.current\?\.click\(\)\}/);
  assert.match(editor, /className="editor-image-input"/);
  assert.match(registration, /ServerDescriptionEditor/);
  assert.match(registration, /queueDescriptionPoster/);
  assert.match(registration, /replaceDescriptionPosterIds/);
  assert.match(registration, /createdServerTitle = result\.server\.title/);
  assert.match(registration, /confirmation: createdServerTitle/);
  assert.match(operator, /ServerDescriptionEditor/);
  assert.match(page, /ServerDescription document=/);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML|contentEditable/);
  assert.doesNotMatch(page, /contentEditable/);
  assert.match(page, /dangerouslySetInnerHTML=\{\{ __html: safeJsonLd\(itemList\) \}\}/);
  assert.match(description, /허용되지 않은 서버 소개 내용/);
  assert.match(description, /홍보 포스터는 최대 12장/);
  assert.match(description, /parseTextRuns/);
  assert.match(description, /descriptionTextSizes/);
  assert.match(description, /descriptionTextSizePxRange = \{ min: 8, max: 72 \}/);
  assert.match(description, /sizePx: normalizeDescriptionTextSizePx\(run\.sizePx\)/);
  assert.match(description, /"callifont", "memoment", "graceSerif", "jejuDoldam", "gmarketSans"/);
  assert.match(description, /온글잎 박다현체/);
  assert.match(description, /descriptionFontFamilies/);
  assert.match(editor, /descriptionFontLabels\[font\]/);
  assert.match(editor, /Select\.Root/);
  assert.match(editor, /추가 글꼴 · 실제 미리보기/);
  assert.match(editor, /label="문단 형식"/);
  assert.match(editor, /label="글자 크기"/);
  assert.match(editor, /aria-label="직접 글자 크기\(px\)"/);
  assert.doesNotMatch(editor, /className="sr-only">직접 글자 크기/);
  assert.match(editor, /<span aria-hidden="true">PX<\/span>/);
  assert.match(editor, /setFontSize\(`\$\{normalized\}px`\)/);
  assert.match(editor, /\{label\} · 실제 미리보기/);
  assert.match(editor, /<Select\.Group>[\s\S]*?<Select\.Label className="description-toolbar-select-label"/);
  assert.doesNotMatch(editor, /<Select\.Value asChild/);
  assert.match(editor, /가나다라마바사 Aa 123/);
  assert.doesNotMatch(editor, /<select/);
  assert.match(page, /descriptionFontFamilies\[run\.font\]/);
  assert.match(page, /run\.sizePx != null \? `\$\{run\.sizePx\}px`/);
  assert.match(description, /bulletList/);
  assert.match(description, /cleanHttps/);
  assert.match(serverRoute, /HTML·소스 문자열은 소개 문서로 저장할 수 없습니다/);
  assert.match(createRoute, /description_document/);
  assert.match(createRoute, /descriptionPlainText/);
  assert.match(serverRoute, /다른 서버의 포스터이거나 삭제된 포스터/);
  assert.match(posterRoute, /server-description-poster/);
  assert.match(posterServe, /X-Content-Type-Options/);
  assert.match(imageAssets, /validateDescriptionPoster/);
  assert.match(imageAssets, /PNG, JPG, WebP/);
  assert.match(schema, /serverDescriptionAssets/);
  assert.match(migration, /CREATE TABLE `server_description_assets`/);
  assert.match(migration, /ADD `description_document`/);
  assert.match(css, /\.description-editor/);
  assert.match(css, /\.toolbar-group \.editor-image-button \{[^}]*align-self:center/);
  assert.match(css, /\.editor-image-input \{ display:none; \}/);
  assert.match(css, /\.server-description-poster/);
  assert.match(css, /\.intro-copy \.server-description-poster\.wide/);
  assert.match(css, /\.intro-copy \{ padding-left:0; \}/);
  assert.doesNotMatch(css, /margin:6px 0 6px -40px/);
  assert.match(css, /\.poster-drag-handle/);
  assert.match(css, /\.ProseMirror-dropcursor/);
  assert.match(css, /\.editor-inline-poster\.editor-collapsed/);
  assert.match(css, /@font-face \{ font-family:MKRCallifontSharpie/);
  assert.match(css, /@font-face \{ font-family:MKROwnglyphDahyeon/);
  assert.match(css, /url\("\/fonts\/pretendard-bold\.woff2"\)/);
  assert.match(css, /\.description-font-content/);
  assert.match(css, /\.description-font-item-copy/);
  assert.match(css, /\.description-toolbar-select-content/);
  assert.match(css, /\.description-toolbar-select-copy\.preview-heading-large/);
  assert.match(css, /\.description-toolbar-select-copy\.preview-size-xlarge/);
  assert.match(css, /\.full-description-editor \.description-size-px-field input \{[^}]*height:31px; min-height:31px/);
  assert.match(css, /\.description-size-px-field > span \{[^}]*position:absolute/);
  assert.match(css, /\.toolbar-group\.selectors > \.description-size-control \{[^}]*grid-column:1\/-1/);
  assert.match(readme, /드롭다운은 브라우저 기본 `<select>` 모양에 의존하지 않고 Radix 기반/);
  assert.match(readme, /무료 웹 사용권을 검증해 제공한 파일만 허용 목록/);
  await Promise.all([
    "callifont-sharpie-bold.ttf", "memoment-kkukkukk.ttf", "grace-serif-bold.otf", "ef-jeju-doldam.ttf",
    "gmarket-sans-bold.ttf", "pretendard-bold.woff2", "bm-dohyeon.ttf", "mona-s12-text-kr.woff2",
    "sb-aggro-bold.ttf", "ownglyph-park-dahyeon.ttf", "paperlogy-7-bold.ttf",
  ].map((font) => access(new URL(`../public/fonts/${font}`, import.meta.url))));
  assert.match(page, /Minecraft\.kr 서버 탑승권/);
  assert.match(page, /ticketEmbed/);
  assert.match(ticketRoute, /BOARDING PASS/);
  assert.match(ticketRoute, /AUTO REFRESH/);
  assert.match(ticketRoute, /const passengerValue =/);
  assert.match(ticketRoute, /fitTextClass\(passengerValue\)/);
  assert.match(ticketRoute, /fitTextClass\(versionValue\)/);
  assert.match(ticketRoute, /fitTextClass\(uptimeValue\)/);
  assert.match(ticketRoute, /container-type:inline-size/);
  assert.match(ticketRoute, /strong\.fit-tiny/);
  assert.match(ticketRoute, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(ticketRoute, /grid-template-rows:auto auto auto/);
  assert.match(ticketRoute, /justify-items:start/);
  assert.match(ticketRoute, /grid-row:auto;grid-column:auto/);
  assert.doesNotMatch(ticketRoute, /<script/);
  assert.match(worker, /frame-ancestors \*/);
  assert.match(worker, /url\.pathname\.startsWith\("\/embed\/server\/"\)/);
});

test("server-renders the platform-first owner login shell", async () => {
  const [response, layout, loginPage, capabilitiesRoute] = await Promise.all([
    render("/login"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/capabilities/route.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  const html = await response.text();
  const head = html.match(/<head[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? "";
  assert.match(html, /운영자 로그인/);
  assert.match(loginPage, /ChatGPT로 안전하게 로그인/);
  assert.match(loginPage, /인증 코드 받기/);
  assert.match(loginPage, /capabilities\.sites && capabilities\.email/);
  assert.match(capabilitiesRoute, /RESEND_API_KEY/);
  assert.match(capabilitiesRoute, /SITES_AUTH_ENABLED/);
  assert.match(head, /<script[^>]*>[\s\S]*minecraft-kr-theme[\s\S]*<\/script>/);
  assert.match(head, /prefers-color-scheme: dark/);
  assert.match(head, /document\.documentElement\.dataset\.theme/);
  assert.match(layout, /storedTheme === "dark" \|\| storedTheme === "light"/);
  assert.match(layout, /<html lang="ko" suppressHydrationWarning>/);
});

test("keeps post-login return targets internal and normalizes theme preferences", () => {
  assert.equal(safeInternalReturnTo("/operator"), "/operator");
  assert.equal(safeInternalReturnTo("/?register=1"), "/?register=1");
  assert.equal(safeInternalReturnTo("/broadcasts?register=1#directory"), "/broadcasts?register=1#directory");
  for (const unsafe of ["https://evil.example/", "//evil.example/", "/\\evil.example/", "javascript:alert(1)", "operator"]) {
    assert.equal(safeInternalReturnTo(unsafe), "/operator");
  }
  assert.equal(safeInternalReturnTo(null), "/operator");
  assert.equal(resolveThemePreference("dark", false), "dark");
  assert.equal(resolveThemePreference("light", true), "light");
  assert.equal(resolveThemePreference("broken", true), "dark");
  assert.equal(resolveThemePreference(null, false), "light");
});

test("server-renders real policy destinations", async () => {
  const [termsResponse, privacyResponse] = await Promise.all([render("/terms"), render("/privacy")]);
  assert.equal(termsResponse.status, 200);
  assert.equal(privacyResponse.status, 200);
  const [terms, privacy] = await Promise.all([termsResponse.text(), privacyResponse.text()]);
  assert.match(terms, /이용약관/);
  assert.match(terms, /프리미엄 광고/);
  assert.match(terms, /zehelper@gmail\.com/);
  assert.match(terms, /https:\/\/discord\.gg\/TgCYTVjBsv/);
  assert.match(privacy, /개인정보 처리방침/);
  assert.match(privacy, /개인정보 처리업무 위탁/);
  assert.match(privacy, /개인정보의 국외 처리·이전/);
  assert.match(privacy, /개인정보 파기 절차와 방법/);
  assert.match(privacy, /Cloudflare, Inc\./);
  assert.match(privacy, /Plus Five Five, Inc\./);
  assert.match(privacy, /zehelper@gmail\.com/);
  assert.match(privacy, /https:\/\/discord\.gg\/TgCYTVjBsv/);
  assert.doesNotMatch(privacy, /mkr_admin_session/);
  assert.doesNotMatch(privacy, /관리자 세션은 최대 8시간/);
  assert.match(privacy, /개인정보침해 신고센터/);
  assert.match(privacy, /mc-heads\.net/);
});

test("ships passwordless owner auth and audited ownership transfer flows", async () => {
  const [login, home, broadcasts, header, operator, registration, admin, userAuth, ownership, worker, schema, migration, packageJson] = await Promise.all([
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readHomeSource(),
    readFile(new URL("../app/broadcasts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-registration-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-ownership.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_lucky_major_mapleleaf.sql", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(login, /one-time-code/);
  assert.match(userAuth, /MAX_CODE_ATTEMPTS = 5/);
  assert.match(userAuth, /SameSite=Lax/);
  assert.match(userAuth, /api\.resend\.com\/emails/);
  assert.match(worker, /X-MKR-Authenticated-Owner/);
  assert.match(home, /ownerSessionChecked/);
  assert.match(home, /router\.push\(`\/login\?returnTo=\$\{encodeURIComponent\("\/\?register=1"\)\}`\)/);
  assert.match(home, /params\.delete\("register"\)/);
  assert.match(login, /safeInternalReturnTo/);
  assert.match(login, /router\.replace\(returnTo\)/);
  assert.match(login, /\/signin-with-chatgpt\?return_to=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(login, /ChatGPT로 안전하게 로그인/);
  assert.match(broadcasts, /encodeURIComponent\("\/broadcasts\?register=1"\)/);
  assert.match(broadcasts, /loginReturnTo="\/broadcasts\?register=1"/);
  assert.match(registration, /router\.push\(`\/login\?returnTo=\$\{encodeURIComponent\(loginReturnTo\)\}`\)/);
  assert.doesNotMatch(home, /window\.location\.assign\("\/login/);
  assert.doesNotMatch(login, /window\.location\.(?:assign|replace)\(\s*returnTo/);
  assert.doesNotMatch(broadcasts, /window\.location\.assign\("\/login/);
  assert.match(header, /내 서버 관리 · 로그인됨/);
  assert.doesNotMatch(home, /nav-owner-link/);
  assert.match(registration, /loginReturnTo = "\/\?register=1"/);
  assert.match(operator, /ServerRegistrationDialog/);
  assert.match(operator, /setRegistrationOpen\(true\)/);
  assert.match(operator, /params\.delete\("register"\)/);
  assert.match(home, /이 서버 주장하기/);
  assert.match(home, /result\.challenge/);
  assert.match(operator, /서버 관리 양도/);
  assert.match(operator, /transferChallenge/);
  assert.match(admin, /소유권 심사/);
  assert.match(ownership, /assertNoOwnershipFinancialLock/);
  assert.match(ownership, /MKR-CLAIM/);
  assert.match(ownership, /MKR-TRANSFER/);
  assert.match(ownership, /owner_verification_status = 'disputed'/);
  assert.match(schema, /server_ownership_transfers/);
  assert.match(schema, /server_ownership_claims/);
  assert.match(migration, /CREATE TABLE `user_accounts`/);
  assert.match(packageJson, /test:ownership/);
});

test("ships responsive, accessible, realtime and exact-spec product assets", async () => {
  const [page, trendChart, timedMotion, operator, registration, adminPage, adminTools, adminSecurity, chatRealtime, chatHook, chatRoom, directoryRoom, directoryRealtime, publicDirectory, premiumAuction, votesApi, worker, css, layout, packageJson, schema, directoryApi, assetApi, assetServe, serverDirectory, serverUpdate, imageAssets, imageCrop, motionCropMigration, og] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../components/player-trend-chart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-timed-motion.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-registration-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-tool-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/chat-realtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/use-chat-realtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/chat-room.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/directory-live.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/directory-realtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/premium-auction.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/votes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/assets/[kind]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/image-assets.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/image-crop-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0013_nappy_starbolt.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/og.png", import.meta.url)),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(page, /ServerRegistrationDialog/);
  assert.match(registration, /prepareImageCropSession/);
  assert.match(registration, /const \[crop, setCrop\]/);
  assert.match(registration, /const \[previews, setPreviews\]/);
  assert.match(registration, /URL\.createObjectURL\(file\)/);
  assert.match(registration, /URL\.revokeObjectURL\(previous\)/);
  assert.match(registration, /서버 아이콘 GIF 미리보기/);
  assert.match(registration, /서버 아이콘 미리보기/);
  assert.match(registration, /저장 준비 완료/);
  assert.match(registration, /정지 이미지·GIF·WebM 사용 가능/);
  assert.match(registration, /register-modal[^>]*onPointerDownOutside/);
  assert.match(registration, /468×60/);
  assert.match(registration, /상세 상단 커버/);
  assert.match(registration, /kind="desktopDetail"/);
  assert.match(registration, /kind="mobileDetail"/);
  assert.doesNotMatch(registration, /bannersReady/);
  assert.match(registration, /assets\[kind\]/);
  assert.match(registration, /미등록 시 기본 배너 자동 적용/);
  assert.match(registration, /이미지는 어떤 크기든 선택하면 규격에 맞춰 실시간 크롭/);
  assert.match(packageJson, /"recharts": "3\.9\.2"/);
  assert.match(page, /dynamic\([\s\S]*?player-trend-chart/);
  assert.match(trendChart, /TrendChartTooltip/);
  assert.match(trendChart, /<AreaChart[^>]*responsive[^>]*accessibilityLayer/);
  assert.match(trendChart, /<ReferenceLine y=\{averagePlayers\}/);
  assert.match(trendChart, /<ReferenceDot x=\{currentPoint\.timestamp\}/);
  assert.match(trendChart, /domain=\{\[0, yAxisMax\]\}/);
  assert.match(page, /const chartYAxisMax = trendChartUpperBound\(peakPlayers\)/);
  assert.match(page, /peak \+ Math\.max\(1, Math\.ceil\(peak \* 0\.15\)\)/);
  assert.doesNotMatch(page, /domain=\{\[0, capacity\]\}/);
  assert.match(trendChart, /정원 대비/);
  assert.match(css, /\.trend-chart-frame \{[^}]*height:270px[^}]*overflow:hidden/);
  assert.match(css, /\.trend-tooltip \{[^}]*backdrop-filter:blur\(8px\)/);
  assert.match(page, /14일 평균/);
  assert.match(trendChart, /전일 대비/);
  assert.match(page, /TRUST SCORE/);
  assert.match(page, /광고·추천수와 무관한 운영 신뢰 지표/);
  assert.match(page, /server\.trustBreakdown\.map/);
  assert.match(publicDirectory, /calculateTrustScore/);
  assert.match(publicDirectory, /server_enforcements/);
  assert.match(publicDirectory, /누적 경고·임시차단·블라인드 이력이 없습니다/);
  assert.match(css, /\.trust-score-gauge/);
  assert.match(css, /\.trust-factor-list/);
  assert.doesNotMatch(page, /chart-average-line|className="player-chart"/);
  assert.match(operator, /DETAIL COVER/);
  assert.match(operator, /상세보기 맨 위 전용 이미지/);
  assert.match(operator, /ImageCropEditor/);
  assert.match(operator, /prepareImageCropSession/);
  assert.match(operator, /const \[editingAsset, setEditingAsset\]/);
  assert.match(operator, /AssetEditDialog/);
  assert.match(operator, /편집 모드 열기/);
  assert.match(operator, /현재 이미지 크롭 편집/);
  assert.match(operator, /이 이미지로 저장/);
  assert.match(operator, /className="motion-crop-controls"/);
  assert.match(operator, /onPointerDown=\{\(event\) =>/);
  assert.match(operator, /움직임 크롭 저장/);
  assert.match(operator, /박스 안을 이동 · 모서리를 드래그해 크기 조절/);
  assert.match(operator, /실시간 결과 미리보기/);
  assert.match(operator, /className="motion-crop-frame"/);
  assert.match(imageCrop, /canvas\.toBlob/);
  assert.match(imageCrop, /가로 위치/);
  assert.match(imageCrop, /실제 저장 결과/);
  assert.match(imageCrop, /className="crop-frame"/);
  assert.match(imageCrop, /requestAnimationFrame/);
  assert.match(imageCrop, /startResize/);
  assert.match(imageCrop, /baseCrop\.width \/ nextWidth/);
  assert.match(imageCrop, /모서리로 크롭 크기 조절/);
  assert.match(imageCrop, /출력 규격 비율은 자동으로 유지/);
  assert.match(imageCrop, /disabled=\{!canMoveX\}/);
  assert.match(imageCrop, /박스 안쪽을 드래그해 위치를 맞추세요/);
  assert.match(imageCrop, /Dialog\.Portal/);
  assert.match(imageCrop, /onPointerDownOutside=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(imageCrop, /onInteractOutside=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(imageCrop, /max="400"/);
  assert.match(imageCrop, /imageSmoothingEnabled = !pixelUpscale/);
  assert.match(imageCrop, /spec\.width, spec\.height/);
  assert.match(operator, /총관리자 직통라인/);
  assert.match(operator, /useChatRealtime/);
  assert.doesNotMatch(operator, /setInterval\(loadDirectThread/);
  assert.match(operator, /다음 주 최상단 광고 경매/);
  assert.match(operator, /acceptedTerms/);
  assert.match(operator, /실시간 입찰 순위/);
  assert.match(operator, /auctionCountdown/);
  assert.match(operator, /낙찰권 권장/);
  assert.match(operator, /운영자 본인인증/);
  assert.match(operator, /5초 자동 갱신/);
  assert.match(operator, /블라인드 구간 · 1초 자동 갱신/);
  assert.match(operator, /종료 시각 비공개/);
  assert.match(operator, /PremiumRegistrationStatus/);
  assert.match(operator, /까지 등록 중/);
  assert.match(operator, /staffIntroEnabled/);
  assert.match(operator, /운영진 추가/);
  assert.match(operator, /MinecraftHead/);
  assert.match(operator, /operator-tool-button refresh/);
  assert.match(operator, /operator-tool-button logout/);
  assert.match(operator, /미등록 시 기본 비주얼/);
  assert.match(operator, /address-case-characters/);
  assert.match(operator, /대소문자만 변경/);
  assert.match(operator, /toggleAddressCharacter/);
  assert.match(adminPage, /OTP 6자리/);
  assert.match(adminPage, /블랙리스트 서버 관리/);
  assert.match(adminTools, /관리자 감사 로그/);
  assert.match(adminPage, /낙찰·결제 확인/);
  assert.match(adminPage, /현재 순위로 조기 마감/);
  assert.match(adminPage, /결제 확인번호 기록/);
  assert.match(adminPage, /admin-auction-history/);
  assert.match(adminPage, /10초 갱신/);
  assert.match(adminPage, /블라인드 구간 · 1초 갱신/);
  assert.match(adminPage, /AdminRealtimeBadge/);
  assert.match(adminPage, /useChatRealtime/);
  assert.match(adminSecurity, /SameSite=Strict/);
  assert.match(adminSecurity, /MAX_LOGIN_FAILURES = 5/);
  assert.match(adminSecurity, /MAX_LOGIN_FAILURES_PER_IP = 20/);
  assert.match(adminSecurity, /verifyTotpCode/);
  assert.match(adminSecurity, /ADMIN_CREDENTIALS_ROTATED_AT/);
  assert.match(adminSecurity, /attempt\.updated_at < credentialsRotatedAt/);
  assert.match(adminSecurity, /row\.created_at < credentialsRotatedAt/);
  assert.match(adminSecurity, /credentialRotationConfigured/);
  assert.match(schema, /admin_sessions/);
  assert.match(schema, /server_blacklist/);
  assert.match(schema, /admin_messages/);
  assert.match(schema, /premium_auctions/);
  assert.match(schema, /blindStartsAt: integer\("blind_starts_at"\)/);
  assert.match(schema, /latestClosesAt: integer\("latest_closes_at"\)/);
  assert.match(schema, /premium_bids/);
  assert.match(schema, /premium_awards/);
  assert.match(schema, /chat_realtime_tickets/);
  assert.match(schema, /server_staff_profiles/);
  assert.match(schema, /server_votes/);
  assert.match(schema, /bridge_telemetry_history/);
  assert.match(schema, /focusX: integer\("focus_x"\)/);
  assert.match(schema, /focusY: integer\("focus_y"\)/);
  assert.match(schema, /zoomPercent: integer\("zoom_percent"\)/);
  assert.match(motionCropMigration, /ADD `focus_x`/);
  assert.match(motionCropMigration, /ADD `focus_y`/);
  assert.match(motionCropMigration, /ADD `zoom_percent`/);
  assert.match(chatRealtime, /DELETE FROM chat_realtime_tickets/);
  assert.match(chatRealtime, /global:admins/);
  assert.match(chatHook, /Math\.min\(10_000/);
  assert.match(chatHook, /visibilitychange/);
  assert.match(chatRoom, /acceptWebSocket/);
  assert.match(chatRoom, /getWebSockets/);
  assert.match(worker, /consumeChatRealtimeTicket/);
  assert.match(worker, /DIRECTORY_LIVE/);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /media-src 'self' blob:/);
  assert.match(directoryRoom, /acceptWebSocket/);
  assert.match(directoryRealtime, /directory\.updated/);
  assert.match(publicDirectory, /server_votes/);
  assert.match(publicDirectory, /bridge_telemetry_history/);
  assert.match(publicDirectory, /bannerTransforms/);
  assert.match(publicDirectory, /desktop_list_focus_x/);
  assert.match(publicDirectory, /icon_content_type/);
  assert.match(publicDirectory, /iconTransform/);
  assert.match(publicDirectory, /synchronizePremiumAuctions/);
  assert.match(publicDirectory, /COALESCE\(premium_bid_amount, 0\) DESC/);
  assert.match(premiumAuction, /suggestedBid/);
  assert.match(premiumAuction, /paymentReference/);
  assert.match(premiumAuction, /randomBlindClose/);
  assert.match(premiumAuction, /blindStartsAt/);
  assert.match(premiumAuction, /latestClosesAt/);
  assert.doesNotMatch(premiumAuction, /biddingClosesAt:\s*row\.bidding_closes_at/);
  assert.match(votesApi, /voteSourceMetadata/);
  assert.match(page, /minecraftUuid/);
  assert.match(page, /directoryConnection/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /href="\/privacy"/);
  assert.doesNotMatch(page, /Votifier|보상 완료|보상 대기/);
  assert.match(registration, /GIF·WebM 원본 크기 자동 맞춤/);
  assert.match(registration, /assetSizeLabel\(kind\)/);
  assert.match(registration, /accept=\{assetAccept\("icon"\)\}/);
  assert.match(registration, /서버 아이콘 WebM 미리보기/);
  assert.match(page, /video\/webm/);
  assert.match(page, /className="banner-webm desktop-banner-webm motion-media"/);
  assert.match(page, /autoPlay loop muted playsInline/);
  assert.match(page, /useTimedMotion/);
  assert.match(timedMotion, /MOTION_WINDOW_MS = 5_000/);
  assert.match(timedMotion, /prefers-reduced-motion: reduce/);
  assert.match(timedMotion, /visibilitychange/);
  assert.match(timedMotion, /setActive\(false\)/);
  assert.match(page, /motionTransformStyle/);
  assert.match(page, /objectPosition/);
  assert.match(page, /function ServerIcon/);
  assert.match(page, /server\.iconContentType === "video\/webm"/);
  assert.doesNotMatch(page, /className="banner-copy"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /aria-pressed/);
  assert.match(page, /@radix-ui\/react-select/);
  assert.match(page, /DirectoryFilterSelect/);
  assert.doesNotMatch(page, /홍보 배너 지원 규격/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--accent-ink:#ffffff/);
  assert.match(css, /\[data-theme="dark"\] \{[\s\S]*?--accent-ink:#04110c/);
  assert.match(css, /\.submit-register \{[^}]*background:var\(--accent\)[^}]*color:var\(--accent-ink\)/);
  assert.match(css, /\.owner-login-card form > button \{[^}]*background:var\(--accent\)[^}]*color:var\(--accent-ink\)/);
  assert.match(css, /\.register-modal \{ width:calc\(100% - 32px\); max-height:calc\(100vh - 32px\); max-height:calc\(100dvh - 32px\); \}/);
  assert.match(css, /Shared Minecraft\.kr dropdown treatment/);
  assert.match(css, /select:not\(\[multiple\]\) \{/);
  assert.match(css, /\.directory-select-content/);
  assert.match(css, /\.directory-select-item\[data-highlighted\]/);
  assert.match(css, /\.operator-tool-button\.logout:hover/);
  assert.match(css, /\.account-status\.signed-in/);
  assert.match(css, /\.upload-visual\.preview img/);
  assert.match(css, /\.upload-preview-badge/);
  assert.match(css, /\.server-results, \.server-main, \.server-card-body \{ min-width: 0; \}/);
  assert.match(css, /\.detail-quick-actions \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.detail-quick-actions \.address-hero \{[^}]*grid-column:span 2/);
  assert.match(css, /\.detail-quick-actions \.vote-button \{[^}]*min-width:132px/);
  assert.match(css, /\.detail-quick-actions \.address-hero \{[^}]*grid-column:1\/-1/);
  assert.match(page, /className="address-hero"[\s\S]*className="vote-button"[\s\S]*server\.discordEnabled/);
  assert.match(css, /\.embed-code code \{[^}]*overflow-x:auto/);
  assert.doesNotMatch(css, /\.address-hero span \{[^}]*text-overflow:ellipsis/);
  assert.match(layout, /metadataBase/);
  assert.match(layout, /width:\s*1200,[\s\S]*?height:\s*630/);
  assert.match(schema, /directory_servers/);
  assert.match(schema, /server_assets/);
  assert.match(directoryApi, /ownerEmailFromRequest/);
  assert.match(directoryApi, /lower\(address\) = \?/);
  assert.match(assetApi, /validateAsset/);
  assert.match(assetApi, /export async function PATCH/);
  assert.match(assetApi, /focus_x = \?/);
  assert.match(assetServe, /responsiveFallback/);
  assert.match(assetServe, /X-MKR-Asset-Fallback/);
  assert.doesNotMatch(publicDirectory, /HAVING COUNT\(DISTINCT a\.kind\) = 2/);
  assert.match(serverDirectory, /const normalizedAddress = address\.toLowerCase\(\)/);
  assert.match(serverDirectory, /address COLLATE NOCASE/);
  assert.match(serverUpdate, /대소문자 표시만 바꿀 수 있습니다/);
  assert.match(serverUpdate, /existing\.address\.toLowerCase\(\) !== input\.address\.toLowerCase\(\)/);
  assert.match(imageAssets, /GIF89a/);
  assert.match(imageAssets, /image\/gif/);
  assert.match(imageAssets, /video\/webm/);
  assert.match(imageAssets, /webmDimensions/);
  assert.match(imageAssets, /icon: \{ width: 256, height: 256,[^\n]*animated: true,[^\n]*motionAutoFit: true/);
  assert.match(imageAssets, /desktopList: \{ width: 468, height: 60/);
  assert.match(imageAssets, /desktopList: \{[^\n]*motionAutoFit: true/);
  assert.match(imageAssets, /desktopDetail: \{ width: 1440, height: 480, maxBytes: 12 \* 1024 \* 1024, animated: true, motionAutoFit: true/);
  assert.match(imageAssets, /motionAssetAutoFits/);
  assert.match(page, /desktopType === "image\/gif"/);
  assert.match(page, /mobileType === "image\/gif"/);
  assert.match(css, /\.banner-webm,\.banner-gif/);
  assert.match(css, /\.server-mark\.generated-server-icon > img,\.server-mark\.generated-server-icon > video/);
  assert.match(css, /\.server-promo-banner \{[^}]*aspect-ratio:39\/5/);
  assert.match(css, /\.asset-edit-grid \{[^}]*align-items:start/);
  assert.match(css, /\.asset-edit-modal-backdrop/);
  assert.match(css, /\.asset-edit-mode-actions/);
  assert.match(css, /\.motion-crop-frame/);
  assert.match(css, /\.motion-crop-workspace/);
  assert.match(css, /\.motion-crop-controls/);
  assert.match(css, /\.auction-eligibility/);
  assert.match(css, /\.admin-auction-history/);
  assert.match(css, /\.asset-edit-card\.desktopList \.asset-current \{[^}]*min-height:0/);
  assert.doesNotMatch(css, /\.server-promo-banner\.has-mobile-list-banner/);
  assert.match(css, /\.staff-toggle input \{[^}]*width:1px !important[^}]*min-height:0 !important/);
  assert.doesNotMatch(page, /hasDedicatedMobileList/);
  assert.doesNotMatch(registration, /BannerUpload kind="mobileList"/);
  assert.doesNotMatch(operator, /kind: "mobileList"/);
  assert.match(page, /const mobileKind = large \? "mobileDetail" : "desktopList"/);
  assert.match(css, /\.asset-edit-grid\.list \{ grid-template-columns:1fr/);
  assert.match(css, /\.row-actions \{ grid-area:actions; width:27px; justify-self:end; grid-template-columns:27px; \}/);
  assert.match(css, /#status-banner \.server-promo-banner \{[^}]*min-height:0[^}]*aspect-ratio:39\/5/);
  assert.match(css, /\.detail-main,\.detail-aside \{[^}]*min-width:0[^}]*max-width:100%/);
  assert.match(css, /\.embed-code \{[^}]*max-width:100%[^}]*overflow:hidden/);
  assert.match(css, /crop-live-pulse/);
  assert.match(css, /\.crop-frame \{[^}]*box-shadow:0 0 0 9999px/);
  assert.match(css, /\.crop-frame > button \{[^}]*pointer-events:auto/);
  assert.match(css, /cursor:nwse-resize/);
  assert.match(css, /cursor:nesw-resize/);
  assert.match(css, /scrollbar-gutter:stable/);
  assert.match(css, /font-variant-numeric:tabular-nums/);
  assert.match(css, /\.crop-modal-backdrop \{[^}]*pointer-events:auto/);
  assert.match(css, /\.crop-dialog \{[^}]*z-index:301[^}]*pointer-events:auto/);
  assert.match(css, /grid-template-columns:repeat\(4,1fr\)/);

  assert.equal(og.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(og.readUInt32BE(16), 1200);
  assert.equal(og.readUInt32BE(20), 630);
});

test("keeps launch UI resilient across narrow layouts, focus flows and optional realtime", async () => {
  const [
    home, broadcasts, header, registration, cropEditor, descriptionEditor,
    admin, login, operator, timedMotion, capabilities, css,
  ] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../app/broadcasts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/public-site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-registration-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/image-crop-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-description-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-timed-motion.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/realtime/capabilities/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(header, /aria-controls="public-primary-navigation"/);
  assert.match(header, /aria-expanded=\{mobileOpen\}/);
  assert.match(header, /aria-label=\{mobileOpen \? "메뉴 닫기" : "메뉴 열기"\}/);
  assert.match(header, /requestAnimationFrame\(\(\) => mobileButtonRef\.current\?\.focus\(\)\)/);
  assert.match(home, /fetch\("\/api\/realtime\/capabilities", \{ cache: "no-store" \}\)/);
  assert.match(home, /if \(!response\.ok \|\| !capabilities\.directory\)/);
  assert.match(capabilities, /Cache-Control": "no-store"/);
  assert.match(home, /DirectoryLoadError/);
  assert.match(home, /role="alert"/);
  assert.match(home, /onCloseAutoFocus/);
  assert.match(registration, /onCloseAutoFocus/);
  assert.doesNotMatch(cropEditor, /window\.addEventListener\("keydown"/);
  assert.match(broadcasts, /role="alert"/);
  assert.match(broadcasts, /aria-busy="true"/);
  assert.match(descriptionEditor, /role="toolbar"/);
  assert.match(descriptionEditor, /role: "textbox"/);
  assert.match(descriptionEditor, /"aria-multiline": "true"/);
  assert.match(admin, /role="tablist"/);
  assert.match(admin, /role="tabpanel"/);
  assert.match(admin, /aria-selected=\{tab === key\}/);
  assert.match(login, /\/signin-with-chatgpt\?return_to=\$\{encodeURIComponent\(returnTo\)\}/);
  assert.match(operator, /authMode === "sites"/);
  assert.match(operator, /\/signout-with-chatgpt\?return_to=\//);
  assert.match(timedMotion, /MOTION_WINDOW_MS = 5_000/);
  assert.match(timedMotion, /document\.visibilityState !== "visible"/);
  assert.match(css, /@media \(max-width: 1120px\)/);
  assert.match(css, /\.header-inner \{ min-width:0;/);
  assert.match(css, /\.server-row > \*,\.small-server-row > \* \{ min-width:0; \}/);
  assert.match(css, /\.motion-media,\.banner-webm,\.banner-gif \{ display:none !important; \}/);
});

test("keeps the transport body limit above the validated image limit", async () => {
  const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(nextConfig, /bodySizeLimit:\s*["']12mb["']/);
});

test("resolves Minecraft nicknames to cached UUIDs before avatar rendering", async () => {
  const [profile, profileApi, head, votesApi, serverUpdate, publicDirectory, serverDirectory, schema, migration] = await Promise.all([
    readFile(new URL("../lib/minecraft-profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/minecraft/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/minecraft-head.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/votes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0019_motionless_jigsaw.sql", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /api\.minecraftservices\.com\/minecraft\/profile\/lookup\/name/);
  assert.match(profile, /PROFILE_TTL_SECONDS = 86_400/);
  assert.match(profile, /NOT_FOUND_TTL_SECONDS = 900/);
  assert.match(profile, /pendingLookups/);
  assert.match(profile, /backfillProfileReferences/);
  assert.match(profile, /UPDATE server_staff_profiles SET nickname = \?, minecraft_uuid = \?/);
  assert.match(profile, /UPDATE server_votes SET nickname = \?, minecraft_uuid = \?/);
  assert.match(profileApi, /stale-while-revalidate=604800/);
  assert.match(head, /window\.setTimeout/);
  assert.match(head, /}, 600\)/);
  assert.match(head, /mc-heads\.net\/avatar\/\$\{identifier\}\/64/);
  assert.doesNotMatch(head, /mc-heads\.net\/avatar\/\$\{[^}]*nickname/);
  assert.match(votesApi, /resolveMinecraftProfile/);
  assert.match(votesApi, /minecraft_uuid/);
  assert.match(serverUpdate, /resolveMinecraftProfiles/);
  assert.match(serverUpdate, /member\.minecraftUuid/);
  assert.match(publicDirectory, /COALESCE\(minecraft_uuid, lower\(nickname\)\)/);
  assert.match(serverDirectory, /minecraftUuid: row\.minecraft_uuid/);
  assert.match(schema, /minecraftProfiles/);
  assert.match(migration, /CREATE TABLE `minecraft_profiles`/);
  assert.match(migration, /server_votes_uuid_daily_idx/);
});

test("ships searchable privacy-preserving administrator vote logs", async () => {
  const [admin, adminApi, votesApi, source, publicDirectory, schema, migration, privacy, css, envExample] = await Promise.all([
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/votes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/votes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/vote-source.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0020_flawless_edwin_jarvis.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /추천 기록/);
  assert.match(admin, /VoteLogControl/);
  assert.match(admin, /서버명 · 주소 · 운영자 · 닉네임 · UUID · 정확한 IP/);
  assert.match(admin, /원문 IP는 저장하지 않습니다/);
  assert.match(adminApi, /requireAdmin/);
  assert.match(adminApi, /voteIpSearchHash/);
  assert.match(adminApi, /source_ip_masked/);
  assert.match(adminApi, /ipMetadataRetentionDays: 90/);
  assert.match(votesApi, /source\.ipMasked/);
  assert.match(votesApi, /source\.ipHash/);
  assert.match(source, /HMAC/);
  assert.match(source, /IP_METADATA_RETENTION_SECONDS = 90 \* 86_400/);
  assert.match(source, /purgeExpiredVoteIpMetadata/);
  assert.match(source, /source_fingerprint = 'expired:' \|\| id/);
  assert.match(source, /hmacHex\(secret, `vote-source-fingerprint-v2\|/);
  assert.doesNotMatch(source, /source_ip_raw/);
  assert.match(publicDirectory, /source_ip_masked TEXT NOT NULL DEFAULT ''/);
  assert.match(schema, /sourceIpHash: text\("source_ip_hash"\)/);
  assert.match(migration, /ADD `source_ip_masked`/);
  assert.match(migration, /server_votes_source_ip_idx/);
  assert.match(privacy, /IP 대조 해시는 90일 후 자동 삭제/);
  assert.match(css, /\.admin-vote-search/);
  assert.match(css, /\.admin-vote-table table \{ min-width:1180px/);
  assert.match(envExample, /VOTE_IP_HASH_SECRET/);
});

test("blocks recommendation spam by pseudonymous IP source without storing raw IP", async () => {
  const [admin, blockApi, unblockApi, votesApi, voteSource, voteRoute, adminSecurity, schema, migration, css] = await Promise.all([
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/vote-blocks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/vote-blocks/[blockId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/votes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/vote-source.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/votes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0021_classy_lady_mastermind.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /동일 IP 추천 차단/);
  assert.match(admin, /차단 해제/);
  assert.match(admin, /VOTE_BLOCK_SECONDS/);
  assert.match(blockApi, /requireAdmin\(request, \{ mutating: true \}\)/);
  assert.match(blockApi, /MAX_BLOCK_SECONDS = 90 \* 86_400/);
  assert.match(blockApi, /source_ip_hash/);
  assert.doesNotMatch(blockApi, /source_ip_raw/);
  assert.match(unblockApi, /vote_source\.unblocked/);
  assert.match(votesApi, /source_block_id/);
  assert.match(voteSource, /assertVoteSourceAllowed/);
  assert.match(voteSource, /추천 기능 이용이 일시 제한/);
  assert.match(voteRoute, /assertVoteSourceAllowed/);
  assert.match(adminSecurity, /CREATE TABLE IF NOT EXISTS vote_source_blocks/);
  assert.match(schema, /voteSourceBlocks/);
  assert.match(migration, /CREATE TABLE `vote_source_blocks`/);
  assert.match(css, /\.admin-vote-block-editor/);
  assert.match(css, /\.admin-vote-block-cell/);
});

test("ships free-form three-tag server categories ranked by live usage", async () => {
  const [page, operator, registration, tagEditor, categoryRules, directory, publicDirectory, css, smoke] = await Promise.all([
    readHomeSource(),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-registration-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-category-tags.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-categories.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/server-crud-smoke.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const categoryOptions = useMemo/);
  assert.match(page, /b\.count - a\.count/);
  assert.match(page, /label: `\$\{item\.value\} \(\$\{item\.count\}\)`/);
  assert.match(page, /options=\{categoryOptions\}/);
  assert.match(operator, /ServerCategoryTags value=\{selected\.categories\}/);
  assert.match(registration, /ServerCategoryTags value=\{categories\}/);
  assert.doesNotMatch(registration, /<option>야생<\/option>/);
  assert.match(tagEditor, /Enter 또는 쉼표로 추가/);
  assert.match(tagEditor, /서버 카테고리/);
  assert.match(categoryRules, /SERVER_CATEGORY_LIMIT = 3/);
  assert.match(categoryRules, /SERVER_CATEGORY_KOREAN_LIMIT = 5/);
  assert.match(categoryRules, /SERVER_CATEGORY_ENGLISH_LIMIT = 8/);
  assert.match(directory, /parseServerCategories\(body\.categories\)/);
  assert.doesNotMatch(directory, /allowedCategories/);
  assert.match(publicDirectory, /readStoredServerCategories/);
  assert.match(css, /\.server-category-chip/);
  assert.match(smoke, /tooManyCategories/);
  assert.match(smoke, /tooLongKoreanCategory/);
  assert.match(smoke, /tooLongEnglishCategory/);
});

test("ships a keyless Minecraft-category live broadcast directory", async () => {
  const [header, broadcasts, route, streams, envExample, devVarsExample, css, worker] = await Promise.all([
    readFile(new URL("../components/public-site-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/broadcasts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/streams/minecraft/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/minecraft-streams.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.dev.vars.example", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(header, /마크 방송/);
  assert.match(header, /href="\/broadcasts"/);
  assert.match(broadcasts, /치지직과 SOOP의 공개 라이브 목록/);
  assert.match(broadcasts, /60_000/);
  assert.match(broadcasts, /viewerCount/);
  assert.match(route, /Cache-Control/);
  assert.match(streams, /https:\/\/api\.chzzk\.naver\.com\/service\/v1\/search\/lives/);
  assert.match(streams, /https:\/\/sch\.sooplive\.com\/api\.php/);
  assert.match(streams, /https:\/\/live\.sooplive\.com\/api\/main_broad_list_api\.php/);
  assert.match(streams, /isExactMinecraftCategory/);
  assert.match(streams, /selectType/);
  assert.match(streams, /selectValue/);
  assert.match(streams, /viewerCount: nonNegativeNumber\(row\.total_view_cnt \?\? row\.current_view_cnt\)/);
  assert.doesNotMatch(envExample, /CHZZK_CLIENT_ID|SOOP_CLIENT_ID/);
  assert.doesNotMatch(devVarsExample, /CHZZK_CLIENT_ID|SOOP_CLIENT_ID/);
  assert.match(css, /\.broadcast-grid/);
  assert.match(css, /\.broadcast-directory-link/);
  assert.match(worker, /https:\/\/livecloud-thumb\.akamaized\.net/);
  assert.match(worker, /https:\/\/nng-phinf\.pstatic\.net/);
  assert.match(worker, /https:\/\/liveimg\.sooplive\.com/);
  assert.match(worker, /https:\/\/profile\.img\.sooplive\.com/);
});

test("automatically removes ended broadcast caches without touching durable server media", async () => {
  const [cache, preview, route, worker, admin, css, vite] = await Promise.all([
    readFile(new URL("../lib/minecraft-stream-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/minecraft-stream-preview.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/cache/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cache, /broadcast-previews\/\$\{stream\.platform\}\/\$\{stream\.id\}/);
  assert.match(cache, /broadcast-profiles\/\$\{stream\.platform\}\/\$\{encodeURIComponent\(stream\.streamerId\)\}/);
  assert.match(cache, /sourceHealthy = live\.sources\[platform\]\?\.ok === true/);
  assert.match(cache, /if \(!sourceHealthy\) skippedPlatforms\.push\(platform\)/);
  assert.match(cache, /media\.list\(\{ prefix, cursor, limit: 1_000 \}\)/);
  assert.match(cache, /media\.delete\(deleteKeys\.slice/);
  assert.doesNotMatch(cache, /server-assets|server-description-assets/);
  assert.match(preview, /broadcastPreviewObjectKey/);
  assert.match(preview, /broadcastProfileObjectKey/);
  assert.match(route, /requireAdmin\(request, \{ mutating: true, stepUp: true \}\)/);
  assert.match(route, /broadcast\.cache\.cleaned/);
  assert.match(worker, /cleanupBroadcastImageCache\(env\.MEDIA\)/);
  assert.match(vite, /crons: \["\*\/5 \* \* \* \*"\]/);
  assert.match(admin, /캐시 정리/);
  assert.match(admin, /종료 방송 캐시 정리/);
  assert.match(css, /\.admin-cache-summary/);
});

test("ships scheduled global notices with secure admin lifecycle controls", async () => {
  const [
    layout, banner, admin, publicRoute, collectionRoute, itemRoute, model, schema, migration, css, smoke,
  ] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/site-announcement-banner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/announcements/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/announcements/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/announcements/[announcementId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/site-announcements.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0022_watery_steve_rogers.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/site-announcements-smoke.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /<SiteAnnouncementBanner initialPayload=\{initialAnnouncements\} \/>/);
  assert.match(layout, /publicAnnouncementState/);
  assert.match(banner, /fetch\("\/api\/announcements", \{ cache: "no-store" \}\)/);
  assert.match(banner, /Dialog\.Trigger/);
  assert.match(banner, /Dialog\.Content/);
  assert.match(banner, /ResizeObserver/);
  assert.match(banner, /requestSequenceRef/);
  assert.match(banner, /role="tablist"/);
  assert.match(banner, /role="tab"/);
  assert.match(banner, /aria-selected/);
  assert.match(banner, /role=\{announcements\.length > 1 \? "tabpanel" : undefined\}/);
  assert.match(banner, /event\.key === "ArrowRight"/);
  assert.match(banner, /site-announcement-meta/);
  assert.match(banner, /site-announcement-detail/);
  assert.doesNotMatch(banner, /dangerouslySetInnerHTML/);
  assert.match(admin, /전 페이지 공지사항/);
  assert.match(admin, /type="datetime-local"/);
  assert.match(admin, /fromKstInput/);
  assert.match(admin, /site-announcements:refresh/);
  assert.match(admin, /revision: form\.revision \?\? undefined/);
  assert.match(admin, /공지를 내리고 보관할까요/);
  assert.match(publicRoute, /s-maxage=15/);
  assert.match(collectionRoute, /requireAdmin\(request, \{ mutating: true \}\)/);
  assert.match(collectionRoute, /NOT EXISTS/);
  assert.match(collectionRoute, /prepareAuditWrite/);
  assert.match(itemRoute, /revision = revision \+ 1/);
  assert.match(itemRoute, /deleted_at = \?/);
  assert.match(model, /starts_at < \? AND ends_at > \?/);
  assert.match(model, /starts_at <= \? AND ends_at > \?/);
  assert.match(model, /invalidatePublicAnnouncementState/);
  assert.match(model, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(schema, /siteAnnouncements = sqliteTable/);
  assert.match(migration, /CREATE TABLE `site_announcements`/);
  assert.match(migration, /site_announcements_period_check/);
  assert.match(css, /--site-announcement-height/);
  assert.match(css, /\.site-announcement-banner \{ position:sticky; top:0;/);
  assert.match(css, /\.site-announcement-trigger \{[^}]*display:grid;[^}]*grid-template-columns:/);
  assert.match(css, /@keyframes site-announcement-sheen/);
  assert.match(css, /@keyframes site-announcement-icon-pulse/);
  assert.match(css, /\*, \*:before, \*:after \{ animation-duration:\.01ms !important;/);
  assert.match(css, /\.site-announcement-banner::before,\.site-announcement-label svg \{ animation:none !important; transform:none; \}/);
  assert.match(smoke, /crossSiteCreate/);
  assert.match(smoke, /missingOriginUpdate/);
  assert.match(smoke, /stale/);
  assert.match(smoke, /detailSha256/);
  assert.match(smoke, /scheduledStartsAt/);
  assert.match(smoke, /afterEnd/);
});

test("uses half-open scheduled notice windows and the nearest transition", () => {
  const published = { status: "published", startsAt: 100, endsAt: 200, deletedAt: null };
  assert.equal(announcementPhase(published, 99), "scheduled");
  assert.equal(announcementPhase(published, 100), "active");
  assert.equal(announcementPhase(published, 199), "active");
  assert.equal(announcementPhase(published, 200), "expired");
  assert.equal(announcementPhase({ ...published, status: "draft" }, 150), "draft");
  assert.equal(announcementPhase({ ...published, deletedAt: 149 }, 150), "deleted");
  assert.equal(nextAnnouncementTransition([{ endsAt: 200 }, { endsAt: 240 }], 180, 150), 180);
  assert.equal(nextAnnouncementTransition([{ endsAt: 200 }], null, 150), 200);
  assert.equal(nextAnnouncementTransition([], 150, 150), null);
});

test("publishes crawlable metadata routes and indexable server detail documents", async () => {
  const [robotsResponse, sitemapResponse, manifestResponse, faviconResponse, adminResponse, serverPage, seoModel, siteUrl, publicDirectory, worker] =
    await Promise.all([
      render("/robots.txt"),
      render("/sitemap.xml"),
      render("/manifest.webmanifest"),
      render("/favicon.ico"),
      render("/admin"),
      readFile(new URL("../app/servers/[serverId]/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../lib/public-server-seo.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/site-url.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/public-directory.ts", import.meta.url), "utf8"),
      readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    ]);

  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-Agent: \*/);
  assert.match(robots, /Sitemap: https:\/\/minecraft-kr-server-list\.korcard001\.chatgpt\.site\/sitemap\.xml/);

  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /<urlset/);
  assert.match(sitemap, /<loc>https:\/\/minecraft-kr-server-list\.korcard001\.chatgpt\.site\/<\/loc>/);

  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.lang, "ko-KR");
  assert.equal(manifest.icons.length, 2);

  assert.equal(faviconResponse.status, 308);
  assert.equal(faviconResponse.headers.get("location"), "http://localhost/icon-192.png");

  assert.equal(adminResponse.status, 200);
  assert.match(await adminResponse.text(), /name="robots" content="noindex, nofollow, noarchive"/);

  assert.match(serverPage, /"@type": "GameServer"/);
  assert.match(serverPage, /alternates: \{ canonical \}/);
  assert.match(serverPage, /safeJsonLd/);
  assert.match(seoModel, /WHERE d\.id = \? AND d\.status = 'active' AND d\.deleted_at IS NULL/);
  assert.doesNotMatch(seoModel, /CREATE TABLE|ALTER TABLE|PRAGMA/);
  assert.match(siteUrl, /localMetadataHost\(requestOrigin\.hostname\)[\s\S]*configured\.origin/);
  assert.doesNotMatch(siteUrl, /hostname === "minecraft\.kr"|hostname === "www\.minecraft\.kr"/);
  assert.match(publicDirectory, /serializePublicRow\(row, now, false\)/);
  assert.match(publicDirectory, /includeDescription \? row\.description : ""/);
  assert.match(worker, /X-Robots-Tag", "noindex, nofollow"/);
});

test("protects destructive administrator work with recent authentication and reversible quarantine", async () => {
  const [security, sessionsApi, stepUpApi, userAuth, accountsApi, serverAdminApi, ownerServerApi, quarantine, operations, worker, schema] = await Promise.all([
    readFile(new URL("../lib/admin-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/sessions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/sessions/step-up/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/user-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/accounts/[accountId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-quarantine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-operations.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(security, /STEP_UP_SECONDS = 5 \* 60/);
  assert.match(security, /code: "step_up_required"/);
  assert.match(security, /admin\.step_up\.succeeded/);
  assert.match(security, /admin\.sessions\.revoked_others/);
  assert.match(security, /source_ip_masked/);
  assert.match(security, /user_agent_label/);
  assert.match(sessionsApi, /listAdminSessions/);
  assert.match(sessionsApi, /revokeAdminSessions/);
  assert.match(stepUpApi, /stepUpAdmin/);

  assert.match(userAuth, /a\.account_status = 'active'/);
  assert.match(userAuth, /account_status = 'suspended'/);
  assert.match(userAuth, /WHERE id = \? AND email = \? AND account_status = 'active'/);
  assert.match(accountsApi, /stepUp: true/);
  assert.match(accountsApi, /DELETE FROM user_sessions/);
  assert.match(accountsApi, /DELETE FROM user_login_codes/);
  assert.match(accountsApi, /DELETE FROM chat_realtime_tickets/);
  assert.match(worker, /a\.account_status = 'active'/);

  assert.match(serverAdminApi, /status_before_deletion = status/);
  assert.match(serverAdminApi, /purgeAfter = now \+ 7 \* 86_400/);
  assert.match(serverAdminApi, /action === "restore"/);
  assert.match(serverAdminApi, /server\.restored/);
  assert.doesNotMatch(serverAdminApi, /DELETE FROM server_assets/);
  assert.doesNotMatch(serverAdminApi, /DELETE FROM server_votes/);
  assert.doesNotMatch(serverAdminApi, /DELETE FROM bridge_servers/);
  assert.match(serverAdminApi, /NOT EXISTS \(\s*SELECT 1 FROM premium_bids/);
  assert.match(serverAdminApi, /NOT EXISTS \(\s*SELECT 1 FROM server_blacklist/);
  assert.match(ownerServerApi, /status_before_deletion = status/);
  assert.doesNotMatch(ownerServerApi, /status IN \('active', 'winner_pending', 'winner'\)/);
  assert.match(quarantine, /purgeExpiredServerQuarantines/);
  assert.match(quarantine, /DELETE FROM server_assets/);
  assert.match(quarantine, /purged_at = \?/);
  assert.match(quarantine, /server\.quarantine\.purged/);
  assert.match(operations, /server_quarantine_purge/);
  assert.match(worker, /runTrackedAdminJob\(env\.DB, "server_quarantine_purge"/);
  assert.match(schema, /elevatedUntil: integer\("elevated_until"\)/);
  assert.match(schema, /accountStatus: text\("account_status"\)/);
  assert.match(schema, /statusBeforeDeletion: text\("status_before_deletion"\)/);
});

test("keeps identity verification references out of administrator browser payloads", async () => {
  const [accountsApi, overviewApi, controls, adminPage] = await Promise.all([
    readFile(new URL("../app/api/admin/accounts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-tool-controls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(accountsApi, /END identity_reference_masked/);
  assert.match(accountsApi, /identityReferenceMasked: row\.identity_reference_masked/);
  assert.doesNotMatch(accountsApi, /identityReference: row\.identity_reference/);
  assert.doesNotMatch(accountsApi, /instr\(lower\(a\.identity_reference\)/);
  assert.match(overviewApi, /END identity_reference_masked/);
  assert.doesNotMatch(overviewApi, /identity_provider, identity_reference,/);
  assert.match(controls, /identityReferenceMasked: string/);
  assert.match(controls, /account\.identityReferenceMasked \|\| "확인번호 없음"/);
  assert.match(controls, /window\.prompt\("인증 결과 확인번호를 입력하세요\.", ""\)/);
  assert.doesNotMatch(controls, /account\.identityReference\b/);
  assert.match(adminPage, /identity_reference_masked: string/);
  assert.doesNotMatch(adminPage, /identity_reference: string/);
});

test("guards owner writes and media uploads against quarantine and financial races", async () => {
  const [serverRoute, assetRoute, descriptionAssetRoute, descriptionAssetItemRoute] = await Promise.all([
    readFile(new URL("../app/api/servers/[serverId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/description-assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/servers/[serverId]/description-assets/[assetId]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(serverRoute, /AND updated_at = \?/);
  assert.match(serverRoute, /SELECT 1 FROM premium_bids WHERE server_id = directory_servers\.id/);
  assert.match(serverRoute, /SELECT 1 FROM premium_awards WHERE server_id = directory_servers\.id/);
  assert.match(serverRoute, /SELECT 1 FROM premium_placements WHERE server_id = directory_servers\.id/);
  assert.match(serverRoute, /WHERE changes\(\) = 1/);
  assert.match(serverRoute, /mutation_guard\.id = \?/);
  assert.match(serverRoute, /const results = await environment\.DB\.batch\(statements\);[\s\S]*results\[0\]\?\.meta\.changes[\s\S]*results\[1\]\?\.meta\.changes/);
  assert.ok(
    serverRoute.indexOf("results[0]?.meta.changes") < serverRoute.indexOf("environment.MEDIA?.delete(asset.object_key)"),
    "unused R2 objects must only be deleted after the guarded server update succeeds",
  );
  assert.match(serverRoute, /DELETE FROM chat_realtime_tickets[\s\S]*quarantined_server\.deleted_at = \?/);

  assert.match(assetRoute, /INSERT INTO server_assets[\s\S]*SELECT \?, \?, \?, \?, \?, \?, \?, \?[\s\S]*guarded_server\.owner_email = \?/);
  assert.match(assetRoute, /guarded_server\.deleted_at IS NULL/);
  assert.match(assetRoute, /guarded_server\.id = server_assets\.server_id[\s\S]*guarded_server\.owner_email = \?/);
  assert.match(assetRoute, /results\.some\(\(result\) => \(result\.meta\.changes \?\? 0\) !== 1\)/);
  assert.match(assetRoute, /results\.some[\s\S]*MEDIA\?\.delete\(objectKey\)[\s\S]*status: 409/);

  assert.match(descriptionAssetRoute, /INSERT INTO server_description_assets[\s\S]*SELECT \?, \?, \?, \?, \?, \?, \?, \?/);
  assert.match(descriptionAssetRoute, /guarded_server\.owner_email = \?/);
  assert.match(descriptionAssetRoute, /guarded_server\.deleted_at IS NULL/);
  assert.match(descriptionAssetRoute, /inserted\.meta\.changes \?\? 0/);
  assert.match(descriptionAssetRoute, /inserted\.meta\.changes[\s\S]*MEDIA\.delete\(objectKey\)[\s\S]*status: 409/);
  assert.match(descriptionAssetItemRoute, /guarded_server\.id = server_description_assets\.server_id/);
  assert.match(descriptionAssetItemRoute, /guarded_server\.deleted_at IS NULL/);
  assert.match(descriptionAssetItemRoute, /deleted\.meta\.changes \?\? 0/);
});
