import { assetSpecs, type AssetKind } from "@/lib/image-assets";
import {
  directoryEnv, directoryErrorResponse, ensureDirectorySchema, optionalOwnerEmail, type DirectoryServerRow,
} from "@/lib/server-directory";

type RouteContext = { params: Promise<{ serverId: string; kind: string }> | { serverId: string; kind: string } };

const responsiveFallback: Partial<Record<AssetKind, AssetKind>> = {
  desktopList: "mobileList",
  mobileList: "desktopList",
  desktopDetail: "mobileDetail",
  mobileDetail: "desktopDetail",
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { serverId, kind } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    if (!(kind in assetSpecs)) return Response.json({ error: "invalid asset kind" }, { status: 400 });
    const requestedKind = kind as AssetKind;
    const fallbackKind = responsiveFallback[requestedKind] ?? requestedKind;
    const environment = await directoryEnv();
    if (!environment.MEDIA) return Response.json({ error: "media storage is not configured" }, { status: 503 });
    await ensureDirectorySchema(environment.DB);
    const server = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<DirectoryServerRow>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    const url = new URL(request.url);
    const localPreview = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const ownerEmail = await optionalOwnerEmail(request);
    if (server.status !== "active" && server.owner_email !== ownerEmail && !localPreview) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const asset = await environment.DB.prepare(`SELECT kind, object_key, content_type, updated_at FROM server_assets
      WHERE server_id = ? AND kind IN (?, ?) ORDER BY CASE WHEN kind = ? THEN 0 ELSE 1 END LIMIT 1`)
      .bind(serverId, requestedKind, fallbackKind, requestedKind)
      .first<{ kind: AssetKind; object_key: string; content_type: string; updated_at: number }>();
    if (!asset) return Response.json({ error: "not found" }, { status: 404 });
    const rangeHeader = request.headers.get("Range");
    let byteRange: { start: number; end: number } | null = null;
    let totalSize: number | null = null;
    if (rangeHeader) {
      const metadata = await environment.MEDIA.head(asset.object_key);
      if (!metadata) return Response.json({ error: "not found" }, { status: 404 });
      totalSize = metadata.size;
      byteRange = parseByteRange(rangeHeader, totalSize);
      if (!byteRange) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}`, "Accept-Ranges": "bytes" } });
      }
    }
    const object = byteRange
      ? await environment.MEDIA.get(asset.object_key, { range: { offset: byteRange.start, length: byteRange.end - byteRange.start + 1 } })
      : await environment.MEDIA.get(asset.object_key);
    if (!object) return Response.json({ error: "not found" }, { status: 404 });
    const headers = new Headers({
      "Content-Type": asset.content_type,
      "Cache-Control": localPreview ? "no-cache" : "public, max-age=3600, stale-while-revalidate=86400",
      "ETag": object.httpEtag,
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    });
    if (byteRange && totalSize !== null) {
      headers.set("Content-Range", `bytes ${byteRange.start}-${byteRange.end}/${totalSize}`);
      headers.set("Content-Length", String(byteRange.end - byteRange.start + 1));
    } else {
      headers.set("Content-Length", String(object.size));
    }
    if (asset.kind !== requestedKind) headers.set("X-MKR-Asset-Fallback", asset.kind);
    return new Response(object.body, { status: byteRange ? 206 : 200, headers });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

function parseByteRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}
