import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const ownerHeaders = { Origin: origin, "Content-Type": "application/json", "X-MKR-Local-Owner": "minecraft-kr-local-preview" };
const ownerUploadHeaders = { Origin: origin, "X-MKR-Local-Owner": "minecraft-kr-local-preview" };
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const title = `CRUD smoke ${suffix}`;
const originalAddress = `crud-${suffix}.minecraft.kr`;
const forbiddenAddress = `crud-reset-${suffix}.minecraft.kr`;

const payload = {
  title,
  shortDescription: "자동 CRUD 회귀 검증 서버",
  description: "등록, 소유자 조회, 수정, 브리지 폐기와 삭제 흐름을 자동으로 검증하는 테스트 서버입니다.",
  descriptionDocument: { version: 1, blocks: [
    { id: "register-heading", type: "heading", level: 2, text: "자동 등록 에디터 검증", align: "left", runs: [{ text: "자동 등록 에디터 검증", color: "green", size: "large", font: "default", bold: true, italic: false, underline: false, strike: false, href: "" }] },
    { id: "register-list", type: "bulletList", align: "left", items: [
      [{ text: "단일 WYSIWYG 소개 저장", color: "default", size: "normal", font: "default", bold: false, italic: false, underline: false, strike: false, href: "" }],
      [{ text: "안전한 목록과 글자 서식", color: "blue", size: "normal", font: "serif", bold: false, italic: true, underline: false, strike: false, href: "" }],
    ] },
  ] },
  edition: "JE",
  minVersion: "1.20.4",
  maxVersion: "1.21.8",
  address: originalAddress,
  port: 25565,
  categories: ["야생", "마인팜", "Hardcore"],
};

function gifFixture(width, height) {
  const bytes = Uint8Array.from([
    0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,
    0x00,0x00,0x00,0xff,0xff,0xff,0x21,0xf9,0x04,0x01,0x00,0x00,0x00,0x00,
    0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,0x01,0x00,0x3b,
  ]);
  bytes[6] = width & 0xff;
  bytes[7] = (width >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (height >> 8) & 0xff;
  return new File([bytes], `${width}x${height}.gif`, { type: "image/gif" });
}

function pngFixture(width, height) {
  const bytes = new Uint8Array(40);
  bytes.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  bytes.set([0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], `${width}x${height}.png`, { type: "image/png" });
}

function concatBytes(...chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function ebmlElement(id, payload) {
  assert.ok(payload.length < 127, "smoke WebM fixture only supports one-byte EBML sizes");
  return concatBytes(Uint8Array.from(id), Uint8Array.of(0x80 | payload.length), payload);
}

function unsignedBytes(value) {
  return value > 0xff ? Uint8Array.of((value >> 8) & 0xff, value & 0xff) : Uint8Array.of(value);
}

function webmFixture(width, height) {
  const docType = ebmlElement([0x42, 0x82], new TextEncoder().encode("webm"));
  const header = ebmlElement([0x1a, 0x45, 0xdf, 0xa3], docType);
  const video = ebmlElement([0xe0], concatBytes(
    ebmlElement([0xb0], unsignedBytes(width)),
    ebmlElement([0xba], unsignedBytes(height)),
  ));
  const trackEntry = ebmlElement([0xae], concatBytes(ebmlElement([0x83], Uint8Array.of(1)), video));
  const tracks = ebmlElement([0x16, 0x54, 0xae, 0x6b], trackEntry);
  const segment = ebmlElement([0x18, 0x53, 0x80, 0x67], tracks);
  return new File([concatBytes(header, segment)], `${width}x${height}.webm`, { type: "video/webm" });
}

const tooManyCategories = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({
  ...payload, address: `category-count-${suffix}.minecraft.kr`, categories: ["야생", "경제", "RPG", "PVP"],
}) });
assert.equal(tooManyCategories.status, 400);
assert.match((await tooManyCategories.json()).error, /최대 3개/);

const tooLongKoreanCategory = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({
  ...payload, address: `category-korean-${suffix}.minecraft.kr`, categories: ["여섯글자태그"],
}) });
assert.equal(tooLongKoreanCategory.status, 400);
assert.match((await tooLongKoreanCategory.json()).error, /한글 5자/);

const tooLongEnglishCategory = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({
  ...payload, address: `category-english-${suffix}.minecraft.kr`, categories: ["HardcoreX"],
}) });
assert.equal(tooLongEnglishCategory.status, 400);
assert.match((await tooLongEnglishCategory.json()).error, /영문·숫자 8자/);

const reservedCategory = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({
  ...payload, address: `category-reserved-${suffix}.minecraft.kr`, categories: ["전체"],
}) });
assert.equal(reservedCategory.status, 400);
assert.match((await reservedCategory.json()).error, /필터 전용/);

const normalizedTitleResponse = await fetch(`${baseUrl}/api/servers`, {
  method: "POST",
  headers: ownerHeaders,
  body: JSON.stringify({
    ...payload,
    title: `  Rollback ${suffix}  `,
    address: `rollback-${suffix}.minecraft.kr`,
  }),
});
assert.equal(normalizedTitleResponse.status, 201);
const normalizedTitleServer = (await normalizedTitleResponse.json()).server;
assert.equal(normalizedTitleServer.title, `Rollback ${suffix}`);
const normalizedTitleCleanup = await fetch(`${baseUrl}/api/servers/${normalizedTitleServer.id}`, {
  method: "DELETE",
  headers: ownerHeaders,
  body: JSON.stringify({ confirmation: normalizedTitleServer.title }),
});
assert.equal(normalizedTitleCleanup.status, 204);

const createResponse = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify(payload) });
assert.equal(createResponse.status, 201);
const created = await createResponse.json();
const id = created.server.id;
assert.deepEqual(created.server.categories, ["야생", "마인팜", "Hardcore"]);
assert.equal(created.server.descriptionDocument.blocks[1].type, "bulletList");
assert.equal(created.server.descriptionDocument.blocks[1].items[1][0].font, "serif");
let currentTitle = title;

try {
  const unauthorized = await fetch(`${baseUrl}/api/servers/${id}`, { method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(unauthorized.status, 401);

  const ownerGet = await fetch(`${baseUrl}/api/servers/${id}`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(ownerGet.status, 200);

  const animatedIcon = new FormData();
  animatedIcon.append("icon", gifFixture(420, 280));
  const animatedIconResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: animatedIcon });
  assert.equal(animatedIconResponse.status, 200);
  const animatedIconBody = await animatedIconResponse.json();
  assert.deepEqual([animatedIconBody.uploaded[0].kind, animatedIconBody.uploaded[0].width, animatedIconBody.uploaded[0].height], ["icon", 420, 280]);

  const iconCropUpdate = await fetch(`${baseUrl}/api/servers/${id}/assets`, {
    method: "PATCH",
    headers: ownerHeaders,
    body: JSON.stringify({ kind: "icon", focusX: 65, focusY: 35, zoom: 180 }),
  });
  assert.equal(iconCropUpdate.status, 200);

  const storedAnimatedIcon = await fetch(`${baseUrl}/api/servers/${id}/assets/icon`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(storedAnimatedIcon.status, 200);
  assert.equal(storedAnimatedIcon.headers.get("content-type"), "image/gif");

  const animatedWebmIcon = new FormData();
  animatedWebmIcon.append("icon", webmFixture(512, 384));
  const animatedWebmIconResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: animatedWebmIcon });
  assert.equal(animatedWebmIconResponse.status, 200);
  const storedAnimatedWebmIcon = await fetch(`${baseUrl}/api/servers/${id}/assets/icon`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(storedAnimatedWebmIcon.headers.get("content-type"), "video/webm");

  const acceptedBanner = new FormData();
  acceptedBanner.append("desktopList", gifFixture(468, 60));
  const acceptedBannerResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: acceptedBanner });
  assert.equal(acceptedBannerResponse.status, 200);
  const acceptedBannerBody = await acceptedBannerResponse.json();
  assert.deepEqual([acceptedBannerBody.uploaded[0].kind, acceptedBannerBody.uploaded[0].width, acceptedBannerBody.uploaded[0].height], ["desktopList", 468, 60]);

  const largeCropBanner = new FormData();
  largeCropBanner.append("desktopList", gifFixture(1200, 200));
  const largeCropBannerResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: largeCropBanner });
  assert.equal(largeCropBannerResponse.status, 200);
  const largeCropBannerBody = await largeCropBannerResponse.json();
  assert.deepEqual([largeCropBannerBody.uploaded[0].width, largeCropBannerBody.uploaded[0].height], [1200, 200]);

  const storedBanner = await fetch(`${baseUrl}/api/servers/${id}/assets/desktopList`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(storedBanner.status, 200);
  assert.equal(storedBanner.headers.get("content-type"), "image/gif");

  const acceptedDetailGif = new FormData();
  acceptedDetailGif.append("desktopDetail", gifFixture(900, 300));
  const acceptedDetailGifResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: acceptedDetailGif });
  assert.equal(acceptedDetailGifResponse.status, 200);
  const acceptedDetailGifBody = await acceptedDetailGifResponse.json();
  assert.deepEqual([acceptedDetailGifBody.uploaded[0].kind, acceptedDetailGifBody.uploaded[0].width, acceptedDetailGifBody.uploaded[0].height], ["desktopDetail", 900, 300]);

  const storedDetailGif = await fetch(`${baseUrl}/api/servers/${id}/assets/desktopDetail`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(storedDetailGif.status, 200);
  assert.equal(storedDetailGif.headers.get("content-type"), "image/gif");

  const acceptedWebm = new FormData();
  acceptedWebm.append("desktopList", webmFixture(468, 60));
  const acceptedWebmResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: acceptedWebm });
  assert.equal(acceptedWebmResponse.status, 200);
  const acceptedWebmBody = await acceptedWebmResponse.json();
  assert.deepEqual([acceptedWebmBody.uploaded[0].kind, acceptedWebmBody.uploaded[0].width, acceptedWebmBody.uploaded[0].height], ["desktopList", 468, 60]);

  const largeCropWebm = new FormData();
  largeCropWebm.append("desktopList", webmFixture(1200, 200));
  const largeCropWebmResponse = await fetch(`${baseUrl}/api/servers/${id}/assets`, { method: "POST", headers: ownerUploadHeaders, body: largeCropWebm });
  assert.equal(largeCropWebmResponse.status, 200);
  const largeCropWebmBody = await largeCropWebmResponse.json();
  assert.deepEqual([largeCropWebmBody.uploaded[0].width, largeCropWebmBody.uploaded[0].height], [1200, 200]);

  const storedWebm = await fetch(`${baseUrl}/api/servers/${id}/assets/desktopList`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(storedWebm.status, 200);
  assert.equal(storedWebm.headers.get("content-type"), "video/webm");
  assert.equal(storedWebm.headers.get("accept-ranges"), "bytes");

  const motionCropUpdate = await fetch(`${baseUrl}/api/servers/${id}/assets`, {
    method: "PATCH",
    headers: ownerHeaders,
    body: JSON.stringify({ kind: "desktopList", focusX: 28, focusY: 72, zoom: 165 }),
  });
  assert.equal(motionCropUpdate.status, 200);
  const motionCropBody = await motionCropUpdate.json();
  assert.deepEqual([motionCropBody.asset.focusX, motionCropBody.asset.focusY, motionCropBody.asset.zoom], [28, 72, 165]);

  const assetMetadata = await fetch(`${baseUrl}/api/servers/${id}/assets`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(assetMetadata.status, 200);
  const assetMetadataBody = await assetMetadata.json();
  const desktopListMetadata = assetMetadataBody.assets.find((asset) => asset.kind === "desktopList");
  assert.deepEqual([desktopListMetadata.focusX, desktopListMetadata.focusY, desktopListMetadata.zoom], [28, 72, 165]);
  const iconMetadata = assetMetadataBody.assets.find((asset) => asset.kind === "icon");
  assert.deepEqual([iconMetadata.focusX, iconMetadata.focusY, iconMetadata.zoom], [65, 35, 180]);

  const rangedWebm = await fetch(`${baseUrl}/api/servers/${id}/assets/desktopList`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview", Range: "bytes=0-15" } });
  assert.equal(rangedWebm.status, 206);
  assert.equal(rangedWebm.headers.get("content-length"), "16");
  assert.match(rangedWebm.headers.get("content-range") ?? "", /^bytes 0-15\/\d+$/);

  const provision = await fetch(`${baseUrl}/api/servers/${id}/bridge`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ platform: "paper" }) });
  assert.equal(provision.status, 201);
  const provisioned = await provision.json();
  assert.equal(provisioned.server.status, "pending_verification");
  assert.ok(provisioned.bridge.serverId);
  assert.ok(provisioned.bridge.bridgeSecret);

  const duplicate = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ ...payload, title: `duplicate ${suffix}` }) });
  assert.equal(duplicate.status, 409);
  const duplicateDifferentCase = await fetch(`${baseUrl}/api/servers`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ ...payload, title: `duplicate case ${suffix}`, address: originalAddress.toUpperCase() }) });
  assert.equal(duplicateDifferentCase.status, 409);

  const rawHtmlDocument = await fetch(`${baseUrl}/api/servers/${id}`, {
    method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ ...payload, descriptionDocument: "<script>alert(1)</script>" }),
  });
  assert.equal(rawHtmlDocument.status, 400);

  const posterForm = new FormData();
  posterForm.append("poster", pngFixture(1200, 1600));
  const posterUpload = await fetch(`${baseUrl}/api/servers/${id}/description-assets`, { method: "POST", headers: ownerUploadHeaders, body: posterForm });
  assert.equal(posterUpload.status, 201);
  const posterAsset = (await posterUpload.json()).asset;
  assert.deepEqual([posterAsset.width, posterAsset.height, posterAsset.contentType], [1200, 1600, "image/png"]);
  const posterServe = await fetch(`${baseUrl}${posterAsset.url}`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(posterServe.status, 200);
  assert.equal(posterServe.headers.get("x-content-type-options"), "nosniff");
  assert.match(posterServe.headers.get("content-security-policy") ?? "", /object-src 'none'/);

  const foreignPoster = await fetch(`${baseUrl}/api/servers/${id}`, {
    method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ ...payload, descriptionDocument: { version: 1, blocks: [
      { id: "heading-foreign", type: "heading", text: "잘못된 포스터 검증", align: "left", color: "default", bold: true, italic: false, underline: false },
      { id: "poster-foreign", type: "poster", assetId: "f".repeat(32), alt: "다른 서버 포스터", caption: "", size: "wide" },
    ] } }),
  });
  assert.equal(foreignPoster.status, 400);

  currentTitle = `${title} updated`;
  const caseUpdate = await fetch(`${baseUrl}/api/servers/${id}`, {
    method: "PATCH",
    headers: ownerHeaders,
    body: JSON.stringify({
      ...payload,
      title: currentTitle,
      description: `${payload.description} 수정 완료.`,
      descriptionDocument: { version: 1, blocks: [
        { id: "heading-main", type: "heading", text: "마인크래프트 서버 핵심 소개", align: "center", runs: [
          { text: "마인크래프트 ", color: "default", size: "normal", bold: true, italic: false, underline: false },
          { text: "서버 핵심 소개", color: "green", size: "large", bold: true, italic: false, underline: true },
        ] },
        { id: "paragraph-main", type: "paragraph", text: "<script>alert('escaped')</script> 태그도 실행되지 않고 일반 소개 글자로만 저장됩니다.", align: "left", runs: [
          { text: "<script>alert('escaped')</script>", color: "red", size: "small", bold: true, italic: false, underline: false },
          { text: " 태그도 실행되지 않고 일반 소개 글자로만 저장됩니다.", color: "default", size: "normal", bold: false, italic: false, underline: false },
        ] },
        { id: "poster-main", type: "poster", assetId: posterAsset.id, alt: "자동 검증 서버 홍보 포스터", caption: "안전한 구조화 포스터 블록", size: "wide" },
      ] },
      minVersion: "1.21.1",
      maxVersion: "1.21.10",
      address: originalAddress.toUpperCase(),
      discordEnabled: true,
      discordUrl: "https://discord.gg/minecraftkr",
      websiteEnabled: true,
      websiteUrl: "https://minecraft.kr",
      kakaoEnabled: true,
      kakaoUrl: "https://open.kakao.com/o/example",
      staffIntroEnabled: true,
      staff: [{
        role: "총관리자",
        nickname: "Notch",
        introduction: "연락처 토글 저장 검증 운영자입니다.",
        discordEnabled: true,
        discordUrl: "notch_admin",
      }],
    }),
  });
  assert.equal(caseUpdate.status, 200);
  const updated = await caseUpdate.json();
  assert.equal(updated.server.title, currentTitle);
  assert.equal(updated.server.description.includes("일반 소개 글자로만 저장됩니다."), true);
  assert.equal(updated.server.descriptionDocument.blocks[0].runs[1].color, "green");
  assert.equal(updated.server.descriptionDocument.blocks[0].runs[1].size, "large");
  assert.equal(updated.server.descriptionDocument.blocks[1].runs[0].text.startsWith("<script>"), true);
  assert.equal(updated.server.descriptionDocument.blocks[2].assetId, posterAsset.id);
  assert.deepEqual([updated.server.minVersion, updated.server.maxVersion], ["1.21.1", "1.21.10"]);
  assert.equal(updated.server.address, originalAddress.toUpperCase());
  assert.equal(updated.ownershipReset, false);
  assert.equal(updated.server.status, "pending_verification");
  assert.deepEqual([updated.server.discordEnabled, updated.server.websiteEnabled, updated.server.kakaoEnabled], [true, true, true]);
  assert.equal(updated.server.kakaoUrl, "https://open.kakao.com/o/example");
  assert.equal(updated.server.staff[0].discordEnabled, true);
  assert.equal(updated.server.staff[0].discordUrl, "notch_admin");

  const bridgeAfterCaseChange = await fetch(`${baseUrl}/api/bridge/status?serverId=${provisioned.bridge.serverId}`, { headers: ownerHeaders });
  assert.equal(bridgeAfterCaseChange.status, 200);

  const forbiddenHostChange = await fetch(`${baseUrl}/api/servers/${id}`, {
    method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ ...payload, title: currentTitle, address: forbiddenAddress }),
  });
  assert.equal(forbiddenHostChange.status, 400);

  const portUpdate = await fetch(`${baseUrl}/api/servers/${id}`, {
    method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ ...payload, title: currentTitle, address: originalAddress.toUpperCase(), port: 25566 }),
  });
  assert.equal(portUpdate.status, 200);
  const portUpdated = await portUpdate.json();
  assert.equal(portUpdated.ownershipReset, true);
  assert.equal(portUpdated.server.status, "draft");
  const removedPoster = await fetch(`${baseUrl}${posterAsset.url}`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(removedPoster.status, 404);

  const revokedBridge = await fetch(`${baseUrl}/api/bridge/status?serverId=${provisioned.bridge.serverId}`, { headers: ownerHeaders });
  assert.equal(revokedBridge.status, 404);

  const wrongDelete = await fetch(`${baseUrl}/api/servers/${id}`, { method: "DELETE", headers: ownerHeaders, body: JSON.stringify({ confirmation: "wrong" }) });
  assert.equal(wrongDelete.status, 400);

  const deleted = await fetch(`${baseUrl}/api/servers/${id}`, { method: "DELETE", headers: ownerHeaders, body: JSON.stringify({ confirmation: currentTitle }) });
  assert.equal(deleted.status, 204);

  const afterDelete = await fetch(`${baseUrl}/api/servers/${id}`, { headers: { "X-MKR-Local-Owner": "minecraft-kr-local-preview" } });
  assert.equal(afterDelete.status, 404);

  const raceTitle = `Race ${suffix}`;
  const racePayload = { ...payload, title: raceTitle, address: `race-${suffix}.minecraft.kr` };
  const raceResponses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${baseUrl}/api/servers`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify(racePayload),
  })));
  assert.equal(raceResponses.filter((response) => response.status === 201).length, 1, "동시 등록은 한 건만 성공해야 합니다.");
  assert.equal(raceResponses.filter((response) => response.status === 409).length, 7, "나머지 동시 등록은 충돌로 거절되어야 합니다.");
  const raceWinner = raceResponses.find((response) => response.status === 201);
  const raceServerId = (await raceWinner.json()).server.id;
  const raceDelete = await fetch(`${baseUrl}/api/servers/${raceServerId}`, {
    method: "DELETE", headers: ownerHeaders, body: JSON.stringify({ confirmation: raceTitle }),
  });
  assert.equal(raceDelete.status, 204);
  console.log("server CRUD smoke: passed");
} finally {
  await fetch(`${baseUrl}/api/servers/${id}`, { method: "DELETE", headers: ownerHeaders, body: JSON.stringify({ confirmation: currentTitle }) }).catch(() => undefined);
}
