export type StreamPlatform = "chzzk" | "soop";

export type MinecraftLiveStream = {
  id: string;
  streamerId: string;
  platform: StreamPlatform;
  title: string;
  streamerName: string;
  previewImageUrl: string;
  thumbnailUrl: string;
  profileImageCacheUrl: string;
  profileImageUrl: string;
  viewerCount: number;
  startedAt: string;
  category: string;
  adult: boolean;
  tags: string[];
  watchUrl: string;
};

export type StreamSourceStatus = {
  available: boolean;
  ok: boolean;
  count: number;
  message: string;
};

export type MinecraftStreamsPayload = {
  streams: MinecraftLiveStream[];
  generatedAt: number;
  refreshAfterSeconds: number;
  sources: Record<StreamPlatform, StreamSourceStatus>;
};

type CacheEntry = { expiresAt: number; payload: MinecraftStreamsPayload };
type SourceResult = { streams: MinecraftLiveStream[]; message: string };

const CHZZK_PUBLIC_SEARCH_ENDPOINT = "https://api.chzzk.naver.com/service/v1/search/lives";
const SOOP_PUBLIC_CATEGORY_ENDPOINT = "https://sch.sooplive.com/api.php";
const SOOP_PUBLIC_LIVE_ENDPOINT = "https://live.sooplive.com/api/main_broad_list_api.php";
const SOOP_MINECRAFT_CATEGORY_FALLBACK = "00040017";
const MINECRAFT_SEARCH_TERM = "마인크래프트";
const CACHE_SECONDS = 60;
export const STREAM_PREVIEW_CACHE_SECONDS = 120;
export const STREAM_PROFILE_CACHE_SECONDS = 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 10_000;
const CHZZK_PAGE_SIZE = 50;
const CHZZK_MAX_PAGES = 3;
const SOOP_PAGE_SIZE = 60;
const SOOP_MAX_PAGES = 4;
const PUBLIC_REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Minecraft.kr live directory/1.0 (+https://minecraft.kr)",
};
let streamCache: CacheEntry | null = null;

export async function minecraftStreams(): Promise<MinecraftStreamsPayload> {
  const nowMs = Date.now();
  if (streamCache?.expiresAt && streamCache.expiresAt > nowMs) return streamCache.payload;

  const [chzzkResult, soopResult] = await Promise.all([
    sourceAttempt(fetchChzzkMinecraftStreams, "치지직"),
    sourceAttempt(fetchSoopMinecraftStreams, "SOOP"),
  ]);
  const streams = [...chzzkResult.streams, ...soopResult.streams]
    .sort((a, b) => b.viewerCount - a.viewerCount || Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const payload: MinecraftStreamsPayload = {
    streams,
    generatedAt: Math.floor(nowMs / 1_000),
    refreshAfterSeconds: CACHE_SECONDS,
    sources: {
      chzzk: sourceStatus(chzzkResult, "치지직"),
      soop: sourceStatus(soopResult, "SOOP"),
    },
  };
  streamCache = { expiresAt: nowMs + CACHE_SECONDS * 1_000, payload };
  return payload;
}

function sourceStatus(result: SourceResult, platform: string): StreamSourceStatus {
  return {
    available: true,
    ok: !result.message,
    count: result.streams.length,
    message: result.message || (result.streams.length
      ? `${platform} 공개 라이브 목록 연동 중`
      : `현재 ${platform} 마인크래프트 라이브가 없습니다.`),
  };
}

async function sourceAttempt(load: () => Promise<MinecraftLiveStream[]>, platform: string): Promise<SourceResult> {
  try {
    return { streams: await load(), message: "" };
  } catch {
    return { streams: [], message: `${platform} 공개 라이브 목록 응답이 지연되고 있습니다.` };
  }
}

async function fetchChzzkMinecraftStreams() {
  const unique = new Map<string, MinecraftLiveStream>();
  let offset = 0;
  for (let pageIndex = 0; pageIndex < CHZZK_MAX_PAGES; pageIndex += 1) {
    const url = new URL(CHZZK_PUBLIC_SEARCH_ENDPOINT);
    url.searchParams.set("keyword", MINECRAFT_SEARCH_TERM);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("size", String(CHZZK_PAGE_SIZE));
    const response = await fetchWithTimeout(url, {
      headers: { ...PUBLIC_REQUEST_HEADERS, Referer: "https://chzzk.naver.com/" },
    });
    if (!response.ok) throw new Error(`CHZZK ${response.status}`);
    const body = record(await response.json() as unknown);
    if (nonNegativeNumber(body.code) !== 200) throw new Error("CHZZK invalid response");
    const content = record(body.content);
    const rows = Array.isArray(content.data) ? content.data : [];
    for (const raw of rows) {
      const stream = normalizeChzzkStream(raw);
      if (stream) unique.set(stream.id, stream);
    }
    const nextOffset = numberValue(record(record(content.page).next).offset);
    if (!rows.length || nextOffset === null || nextOffset <= offset) break;
    offset = nextOffset;
  }
  return [...unique.values()];
}

function normalizeChzzkStream(raw: unknown): MinecraftLiveStream | null {
  const wrapper = record(raw);
  const live = record(wrapper.live);
  const channel = record(wrapper.channel ?? live.channel);
  const category = stringValue(live.liveCategoryValue);
  const channelId = stringValue(channel.channelId ?? live.channelId);
  const liveId = stringValue(live.liveId);
  if (!isExactMinecraftCategory(category) || !channelId || !liveId) return null;
  return {
    id: `chzzk-${liveId}`,
    streamerId: channelId,
    platform: "chzzk",
    title: stringValue(live.liveTitle) || "마인크래프트 라이브",
    streamerName: stringValue(channel.channelName) || "치지직 스트리머",
    previewImageUrl: `/api/streams/minecraft/previews/${encodeURIComponent(`chzzk-${liveId}`)}`,
    thumbnailUrl: normalizeImageUrl(stringValue(live.liveImageUrl ?? live.liveThumbnailImageUrl)).replaceAll("{type}", "480"),
    profileImageCacheUrl: `/api/streams/minecraft/profiles/${encodeURIComponent(`chzzk-${liveId}`)}`,
    profileImageUrl: normalizeImageUrl(stringValue(channel.channelImageUrl)),
    viewerCount: nonNegativeNumber(live.concurrentUserCount),
    startedAt: koreaDateString(live.openDate),
    category,
    adult: live.adult === true,
    tags: stringArray(live.tags).slice(0, 5),
    watchUrl: `https://chzzk.naver.com/live/${encodeURIComponent(channelId)}`,
  };
}

async function fetchSoopMinecraftStreams() {
  const categoryId = await resolveSoopMinecraftCategoryId();
  const unique = new Map<string, MinecraftLiveStream>();
  for (let pageNo = 1; pageNo <= SOOP_MAX_PAGES; pageNo += 1) {
    const url = new URL(SOOP_PUBLIC_LIVE_ENDPOINT);
    url.searchParams.set("selectType", "cate");
    url.searchParams.set("selectValue", categoryId);
    url.searchParams.set("orderType", "view_cnt");
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("strmLangType", "ko_KR");
    url.searchParams.set("lang", "ko_KR");
    const response = await fetchWithTimeout(url, {
      headers: { ...PUBLIC_REQUEST_HEADERS, Referer: "https://www.sooplive.com/" },
    });
    if (!response.ok) throw new Error(`SOOP live ${response.status}`);
    const body = record(await response.json() as unknown);
    const rows = Array.isArray(body.broad) ? body.broad : [];
    for (const raw of rows) {
      const stream = normalizeSoopStream(raw);
      if (stream) unique.set(stream.id, stream);
    }
    const total = nonNegativeNumber(body.total_cnt ?? body.totalCnt);
    if (!rows.length || pageNo * SOOP_PAGE_SIZE >= total) break;
  }
  return [...unique.values()];
}

async function resolveSoopMinecraftCategoryId() {
  try {
    const url = new URL(SOOP_PUBLIC_CATEGORY_ENDPOINT);
    url.searchParams.set("m", "categoryList");
    url.searchParams.set("szPlatform", "pc");
    const response = await fetchWithTimeout(url, {
      headers: { ...PUBLIC_REQUEST_HEADERS, Referer: "https://www.sooplive.com/" },
    });
    if (!response.ok) return SOOP_MINECRAFT_CATEGORY_FALLBACK;
    const body = record(await response.json() as unknown);
    const rows = Array.isArray(record(body.data).list) ? record(body.data).list as unknown[] : [];
    const minecraft = rows.map(record).find((row) => isExactMinecraftCategory(stringValue(row.category_name)));
    return stringValue(minecraft?.category_no) || SOOP_MINECRAFT_CATEGORY_FALLBACK;
  } catch {
    return SOOP_MINECRAFT_CATEGORY_FALLBACK;
  }
}

function normalizeSoopStream(raw: unknown): MinecraftLiveStream | null {
  const row = record(raw);
  const broadNo = stringValue(row.broad_no);
  const userId = stringValue(row.user_id);
  const category = stringValue(row.category_name) || stringArray(row.category_tags)[0] || "";
  const password = stringValue(row.is_password).toUpperCase();
  if (!broadNo || !userId || !isExactMinecraftCategory(category) || password === "Y" || password === "1") return null;
  return {
    id: `soop-${broadNo}`,
    streamerId: userId,
    platform: "soop",
    title: stringValue(row.broad_title) || "마인크래프트 라이브",
    streamerName: stringValue(row.user_nick) || userId,
    previewImageUrl: `/api/streams/minecraft/previews/${encodeURIComponent(`soop-${broadNo}`)}`,
    thumbnailUrl: normalizeImageUrl(stringValue(row.broad_thumb)),
    profileImageCacheUrl: `/api/streams/minecraft/profiles/${encodeURIComponent(`soop-${broadNo}`)}`,
    profileImageUrl: buildSoopProfileUrl(userId),
    // SOOP's own live directory displays and sorts by total_view_cnt. The
    // current_view_cnt field is a narrower sub-count, not the directory total.
    viewerCount: nonNegativeNumber(row.total_view_cnt ?? row.current_view_cnt),
    startedAt: koreaDateString(row.broad_start),
    category,
    adult: stringValue(row.broad_grade) === "19",
    tags: [...stringArray(row.hash_tags), ...stringArray(row.auto_hashtags)].slice(0, 5),
    watchUrl: `https://play.sooplive.com/${encodeURIComponent(userId)}/${encodeURIComponent(broadNo)}`,
  };
}

function isExactMinecraftCategory(value: string) {
  return /^(minecraft|마인크래프트)$/i.test(value.normalize("NFC").trim());
}

async function fetchWithTimeout(input: URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(input, { ...init, redirect: "follow", signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = numberValue(value);
  return parsed === null ? 0 : Math.max(0, Math.round(parsed));
}

function normalizeImageUrl(value: string) {
  if (value.startsWith("//")) return `https:${value}`;
  return /^https:\/\//i.test(value) ? value : "";
}

function buildSoopProfileUrl(userId: string) {
  return `https://profile.img.sooplive.com/LOGO/${encodeURIComponent(userId.slice(0, 2))}/${encodeURIComponent(userId)}/${encodeURIComponent(userId)}.jpg`;
}

function validDateString(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
}

function koreaDateString(value: unknown) {
  const candidate = stringValue(value).replace(" ", "T");
  const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(candidate) ? `${candidate}+09:00` : candidate;
  return validDateString(withZone);
}
