import {
  minecraftStreams, type MinecraftLiveStream, type MinecraftStreamsPayload, type StreamPlatform,
} from "@/lib/minecraft-streams";

const CACHE_KINDS = ["preview", "profile"] as const;
const PLATFORMS: StreamPlatform[] = ["chzzk", "soop"];
const DELETE_BATCH_SIZE = 100;

type CacheKind = (typeof CACHE_KINDS)[number];
type CacheCounter = { objects: number; bytes: number };

export type BroadcastImageCacheStats = CacheCounter & {
  byKind: Record<CacheKind, CacheCounter>;
  byPlatform: Record<StreamPlatform, CacheCounter>;
};

export type BroadcastImageCacheCleanup = {
  generatedAt: number;
  scanned: number;
  retained: number;
  deleted: number;
  deletedBytes: number;
  skippedPlatforms: StreamPlatform[];
  before: BroadcastImageCacheStats;
  after: BroadcastImageCacheStats;
};

export function broadcastPreviewObjectKey(stream: Pick<MinecraftLiveStream, "platform" | "id">) {
  return `broadcast-previews/${stream.platform}/${stream.id}`;
}

export function broadcastProfileObjectKey(stream: Pick<MinecraftLiveStream, "platform" | "streamerId">) {
  return `broadcast-profiles/${stream.platform}/${encodeURIComponent(stream.streamerId)}`;
}

export async function broadcastImageCacheStats(media: R2Bucket): Promise<BroadcastImageCacheStats> {
  const stats = emptyStats();
  for (const platform of PLATFORMS) {
    for (const kind of CACHE_KINDS) {
      const objects = await listAll(media, cachePrefix(platform, kind));
      for (const object of objects) addObject(stats, kind, platform, object.size);
    }
  }
  return stats;
}

export async function cleanupBroadcastImageCache(
  media: R2Bucket,
  payload?: MinecraftStreamsPayload,
): Promise<BroadcastImageCacheCleanup> {
  const live = payload ?? await minecraftStreams();
  const activeKeys = liveCacheKeys(live.streams);
  const before = emptyStats();
  const removed = emptyStats();
  const deleteKeys: string[] = [];
  const skippedPlatforms: StreamPlatform[] = [];
  let scanned = 0;

  for (const platform of PLATFORMS) {
    const sourceHealthy = live.sources[platform]?.ok === true;
    if (!sourceHealthy) skippedPlatforms.push(platform);
    for (const kind of CACHE_KINDS) {
      const objects = await listAll(media, cachePrefix(platform, kind));
      for (const object of objects) {
        addObject(before, kind, platform, object.size);
        if (!sourceHealthy) continue;
        scanned += 1;
        if (activeKeys[kind].has(object.key)) continue;
        deleteKeys.push(object.key);
        addObject(removed, kind, platform, object.size);
      }
    }
  }

  for (let index = 0; index < deleteKeys.length; index += DELETE_BATCH_SIZE) {
    await media.delete(deleteKeys.slice(index, index + DELETE_BATCH_SIZE));
  }

  return {
    generatedAt: live.generatedAt,
    scanned,
    retained: before.objects - removed.objects,
    deleted: removed.objects,
    deletedBytes: removed.bytes,
    skippedPlatforms,
    before,
    after: subtractStats(before, removed),
  };
}

function liveCacheKeys(streams: MinecraftLiveStream[]) {
  const preview = new Set<string>();
  const profile = new Set<string>();
  for (const stream of streams) {
    preview.add(broadcastPreviewObjectKey(stream));
    profile.add(broadcastProfileObjectKey(stream));
  }
  return { preview, profile };
}

function cachePrefix(platform: StreamPlatform, kind: CacheKind) {
  return `broadcast-${kind === "preview" ? "previews" : "profiles"}/${platform}/`;
}

async function listAll(media: R2Bucket, prefix: string) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await media.list({ prefix, cursor, limit: 1_000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function emptyCounter(): CacheCounter {
  return { objects: 0, bytes: 0 };
}

function emptyStats(): BroadcastImageCacheStats {
  return {
    ...emptyCounter(),
    byKind: { preview: emptyCounter(), profile: emptyCounter() },
    byPlatform: { chzzk: emptyCounter(), soop: emptyCounter() },
  };
}

function addObject(stats: BroadcastImageCacheStats, kind: CacheKind, platform: StreamPlatform, bytes: number) {
  stats.objects += 1;
  stats.bytes += bytes;
  stats.byKind[kind].objects += 1;
  stats.byKind[kind].bytes += bytes;
  stats.byPlatform[platform].objects += 1;
  stats.byPlatform[platform].bytes += bytes;
}

function subtractStats(current: BroadcastImageCacheStats, removed: BroadcastImageCacheStats): BroadcastImageCacheStats {
  return {
    objects: current.objects - removed.objects,
    bytes: current.bytes - removed.bytes,
    byKind: {
      preview: subtractCounter(current.byKind.preview, removed.byKind.preview),
      profile: subtractCounter(current.byKind.profile, removed.byKind.profile),
    },
    byPlatform: {
      chzzk: subtractCounter(current.byPlatform.chzzk, removed.byPlatform.chzzk),
      soop: subtractCounter(current.byPlatform.soop, removed.byPlatform.soop),
    },
  };
}

function subtractCounter(current: CacheCounter, removed: CacheCounter): CacheCounter {
  return { objects: current.objects - removed.objects, bytes: current.bytes - removed.bytes };
}
