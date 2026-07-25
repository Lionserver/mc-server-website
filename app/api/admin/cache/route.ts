import { adminErrorResponse, requireAdmin, writeAudit } from "@/lib/admin-security";
import { broadcastImageCacheStats, cleanupBroadcastImageCache } from "@/lib/minecraft-stream-cache";

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    if (!environment.MEDIA) return Response.json({ error: "이미지 저장소가 연결되지 않았습니다." }, { status: 503 });
    return Response.json({ stats: await broadcastImageCacheStats(environment.MEDIA) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    if (!environment.MEDIA) return Response.json({ error: "이미지 저장소가 연결되지 않았습니다." }, { status: 503 });
    const cleanup = await cleanupBroadcastImageCache(environment.MEDIA);
    await writeAudit(environment.DB, session.email, "broadcast.cache.cleaned", "r2_cache", "broadcast-images", {
      deleted: cleanup.deleted,
      deletedBytes: cleanup.deletedBytes,
      retained: cleanup.retained,
      skippedPlatforms: cleanup.skippedPlatforms,
    });
    return Response.json({ cleanup, stats: cleanup.after }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
