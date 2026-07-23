import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_TEMPORARY_ADMIN_ACCESS_SECONDS, temporaryAdminSession } from "../lib/admin-temporary-access.mjs";
import { resolveThemePreference, safeInternalReturnTo } from "../lib/browser-preferences.mjs";

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

test("server-renders the Minecraft.kr product shell", async () => {
  const [pageSource, headerSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
  assert.match(html, /https:\/\/minecraft\.kr\/og\.png/);
  assert.match(headerSource, /className="brand header-brand"[^\n]*MINECRAFT SERVER LIST/);
  assert.doesNotMatch(headerSource, /className="brand header-brand"[^\n]*brand-mark/);
  assert.doesNotMatch(pageSource, /실제 추천 기록 기준 · PC·모바일 공용 GIF·WebM 468×60/);
  assert.doesNotMatch(pageSource, /프리미엄 노출과 일반 추천 순위를 분리해 표시합니다/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships a measured small-community server directory", async () => {
  const [page, directory, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
  assert.match(css, /\.small-server-row/);
});

test("ships a seven-day newly registered server directory", async () => {
  const [page, directory, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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

test("limits temporary administrator access to the authenticated Sites user and one hour", async () => {
  const now = 1_800_000_000;
  const expiresAt = now + MAX_TEMPORARY_ADMIN_ACCESS_SECONDS;
  assert.deepEqual(
    temporaryAdminSession("Owner@Example.com", "owner@example.com", String(expiresAt), now),
    { email: "owner@example.com", expiresAt },
  );
  assert.equal(temporaryAdminSession("other@example.com", "owner@example.com", String(expiresAt), now), null);
  assert.equal(temporaryAdminSession(null, "owner@example.com", String(expiresAt), now), null);
  assert.equal(temporaryAdminSession("owner@example.com", "owner@example.com", String(now), now), null);
  assert.equal(temporaryAdminSession("owner@example.com", "owner@example.com", String(expiresAt + 1), now), null);
  assert.equal(temporaryAdminSession("owner@example.com", "owner@example.com", ` ${expiresAt}`, now), null);
  assert.equal(temporaryAdminSession("owner@example.com", "owner@example.com", "1.8000036e9", now), null);

  const [security, sessionRoute, adminPage, envExample, devVarsExample] = await Promise.all([
    readFile(new URL("../lib/admin-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.dev.vars.example", import.meta.url), "utf8"),
  ]);
  assert.match(security, /oai-authenticated-user-email/);
  assert.match(security, /if \(options\?\.mutating\) assertSameOrigin\(request\)/);
  assert.match(security, /temporary: true/);
  assert.match(security, /temporaryBypassOptOutCookie/);
  assert.match(security, /temporary-disabled-/);
  assert.match(sessionRoute, /authMode: session\.authMode/);
  assert.match(sessionRoute, /"Cache-Control": "no-store"/);
  assert.match(sessionRoute, /admin\.temporary_access\.started/);
  assert.match(adminPage, /임시 접근/);
  assert.match(adminPage, /overview\.admin\.expiresAt \* 1000 - Date\.now\(\)/);
  assert.match(adminPage, /setAuthenticated\(false\);[\s\S]*setOverview\(null\)/);
  assert.match(envExample, /ADMIN_TEMP_BYPASS_EMAIL=""/);
  assert.match(envExample, /ADMIN_TEMP_BYPASS_UNTIL=""/);
  assert.match(devVarsExample, /ADMIN_TEMP_BYPASS_EMAIL=""/);
  assert.match(devVarsExample, /ADMIN_TEMP_BYPASS_UNTIL=""/);
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
  assert.doesNotMatch(`${editor}\n${page}`, /dangerouslySetInnerHTML|contentEditable/);
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

test("server-renders the email owner login shell", async () => {
  const [response, layout] = await Promise.all([
    render("/login"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  const html = await response.text();
  const head = html.match(/<head[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? "";
  assert.match(html, /이메일로 로그인/);
  assert.match(html, /인증 코드 받기/);
  assert.match(html, /비밀번호 없이 이메일 인증 코드/);
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
  assert.match(broadcasts, /encodeURIComponent\("\/broadcasts\?register=1"\)/);
  assert.match(broadcasts, /loginReturnTo="\/broadcasts\?register=1"/);
  assert.match(registration, /router\.push\(`\/login\?returnTo=\$\{encodeURIComponent\(loginReturnTo\)\}`\)/);
  assert.doesNotMatch(home, /window\.location\.assign\("\/login/);
  assert.doesNotMatch(login, /window\.location\.(?:assign|replace)/);
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
  const [page, operator, registration, adminPage, adminSecurity, chatRealtime, chatHook, chatRoom, directoryRoom, directoryRealtime, publicDirectory, premiumAuction, votesApi, worker, css, layout, packageJson, schema, directoryApi, assetApi, assetServe, serverDirectory, serverUpdate, imageAssets, imageCrop, motionCropMigration, og] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operator/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/server-registration-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
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
  assert.match(registration, /서버 아이콘 GIF·이미지 미리보기/);
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
  assert.match(page, /TrendChartTooltip/);
  assert.match(page, /<AreaChart[^>]*responsive[^>]*accessibilityLayer/);
  assert.match(page, /<ReferenceLine y=\{averagePlayers\}/);
  assert.match(page, /<ReferenceDot x=\{currentPoint\.timestamp\}/);
  assert.match(page, /domain=\{\[0, yAxisMax\]\}/);
  assert.match(page, /const chartYAxisMax = trendChartUpperBound\(peakPlayers\)/);
  assert.match(page, /peak \+ Math\.max\(1, Math\.ceil\(peak \* 0\.15\)\)/);
  assert.doesNotMatch(page, /domain=\{\[0, capacity\]\}/);
  assert.match(page, /정원 대비/);
  assert.match(css, /\.trend-chart-frame \{[^}]*height:270px[^}]*overflow:hidden/);
  assert.match(css, /\.trend-tooltip \{[^}]*backdrop-filter:blur\(8px\)/);
  assert.match(page, /14일 평균/);
  assert.match(page, /전일 대비/);
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
  assert.match(adminPage, /관리자 감사 로그/);
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
  assert.match(adminSecurity, /verifyTotp/);
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
  assert.match(page, /className="banner-webm desktop-banner-webm"/);
  assert.match(page, /autoPlay loop muted playsInline/);
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
  assert.match(layout, /width: 1200, height: 630/);
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
  assert.match(source, /hmacHex\(secret, `vote-source-fingerprint-v1\|/);
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
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
  assert.match(route, /requireAdmin\(request, \{ mutating: true \}\)/);
  assert.match(route, /broadcast\.cache\.cleaned/);
  assert.match(worker, /cleanupBroadcastImageCache\(env\.MEDIA\)/);
  assert.match(vite, /crons: \["\*\/5 \* \* \* \*"\]/);
  assert.match(admin, /캐시 정리/);
  assert.match(admin, /종료 방송 캐시 정리/);
  assert.match(css, /\.admin-cache-summary/);
});
