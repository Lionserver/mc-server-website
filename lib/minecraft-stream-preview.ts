import { directoryEnv } from "@/lib/server-directory";
import {
  minecraftStreams, STREAM_PREVIEW_CACHE_SECONDS, STREAM_PROFILE_CACHE_SECONDS, type MinecraftLiveStream,
} from "@/lib/minecraft-streams";
import { broadcastPreviewObjectKey, broadcastProfileObjectKey } from "@/lib/minecraft-stream-cache";

const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type CachedPreview = {
  body: BodyInit | null;
  contentType: string;
  contentLength: number;
  etag: string;
  capturedAt: number;
};

export async function minecraftStreamPreview(request: Request, streamId: string) {
  return minecraftStreamCachedImage(request, streamId, "preview");
}

export async function minecraftStreamerProfile(request: Request, streamId: string) {
  return minecraftStreamCachedImage(request, streamId, "profile");
}

async function minecraftStreamCachedImage(request: Request, streamId: string, kind: "preview" | "profile") {
  if (!/^(chzzk|soop)-[a-zA-Z0-9_-]{1,100}$/.test(streamId)) {
    return Response.json({ error: "invalid stream id" }, { status: 400 });
  }

  const payload = await minecraftStreams();
  const stream = payload.streams.find((candidate) => candidate.id === streamId);
  const sourceUrl = kind === "preview" ? stream?.thumbnailUrl : stream?.profileImageUrl;
  if (!stream || !sourceUrl) return Response.json({ error: `${kind} image not found` }, { status: 404 });

  const environment = await directoryEnv();
  const objectKey = kind === "preview" ? broadcastPreviewObjectKey(stream) : broadcastProfileObjectKey(stream);
  const cachedObject = environment.MEDIA ? await environment.MEDIA.get(objectKey) : null;
  const cached = cachedObject ? previewFromObject(cachedObject) : null;
  const freshAfter = Date.now() - (kind === "preview" ? STREAM_PREVIEW_CACHE_SECONDS : STREAM_PROFILE_CACHE_SECONDS) * 1_000;

  if (cached && cached.capturedAt >= freshAfter) return imageResponse(request, cached, kind, "HIT");

  try {
    const captured = await capturePlatformImage(stream, sourceUrl);
    if (environment.MEDIA) {
      await environment.MEDIA.put(objectKey, captured.bytes, {
        httpMetadata: { contentType: captured.contentType },
        customMetadata: {
          capturedAt: String(captured.capturedAt),
          platform: stream.platform,
          streamId: stream.id,
          sourceEtag: captured.sourceEtag,
        },
      });
    }
    return imageResponse(request, {
      body: captured.bytes,
      contentType: captured.contentType,
      contentLength: captured.bytes.byteLength,
      etag: captured.sourceEtag || `W/\"preview-${stream.id}-${captured.capturedAt}\"`,
      capturedAt: captured.capturedAt,
    }, kind, cached ? "REFRESH" : environment.MEDIA ? "MISS" : "BYPASS");
  } catch {
    if (cached) return imageResponse(request, cached, kind, "STALE");
    return Response.json({ error: "live preview is temporarily unavailable" }, {
      status: 502,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}

function previewFromObject(object: R2ObjectBody): CachedPreview {
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType || "image/jpeg",
    contentLength: object.size,
    etag: object.httpEtag,
    capturedAt: Number(object.customMetadata?.capturedAt) || object.uploaded.getTime(),
  };
}

async function capturePlatformImage(stream: MinecraftLiveStream, sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      Referer: stream.platform === "chzzk" ? "https://chzzk.naver.com/" : "https://www.sooplive.com/",
      "User-Agent": "Minecraft.kr live preview cache/1.0 (+https://minecraft.kr)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`preview upstream ${response.status}`);
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (!ALLOWED_CONTENT_TYPES.has(contentType) || (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BYTES)) {
    throw new Error("unsupported preview image");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 32 || bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error("invalid preview image size");
  return {
    bytes,
    contentType,
    capturedAt: Date.now(),
    sourceEtag: response.headers.get("ETag") ?? "",
  };
}

function imageResponse(request: Request, preview: CachedPreview, kind: "preview" | "profile", cacheState: "HIT" | "MISS" | "REFRESH" | "STALE" | "BYPASS") {
  const headers = new Headers({
    "Content-Type": preview.contentType,
    "Content-Length": String(preview.contentLength),
    "Cache-Control": "public, max-age=45, stale-while-revalidate=240",
    "ETag": preview.etag,
    "X-Content-Type-Options": "nosniff",
    "X-MKR-Image-Kind": kind,
    "X-MKR-Image-Cache": cacheState,
    "X-MKR-Image-Captured-At": new Date(preview.capturedAt).toISOString(),
  });
  if (request.headers.get("If-None-Match") === preview.etag) return new Response(null, { status: 304, headers });
  return new Response(preview.body, { headers });
}
