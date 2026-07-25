import { ensureAdminSchema } from "@/lib/admin-security";
import { directoryEnv, directoryErrorResponse, optionalOwnerEmail, ownerEmailFromRequest, type DirectoryServerRow } from "@/lib/server-directory";
import { assertSameOrigin } from "@/lib/user-auth";

type RouteContext = { params: Promise<{ serverId: string; assetId: string }> | { serverId: string; assetId: string } };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { serverId, assetId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId) || !/^[a-f0-9]{32}$/.test(assetId)) return Response.json({ error: "invalid asset id" }, { status: 400 });
    const environment = await directoryEnv();
    if (!environment.MEDIA) return Response.json({ error: "media storage is not configured" }, { status: 503 });
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<DirectoryServerRow>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    const url = new URL(request.url);
    const localPreview = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const ownerEmail = await optionalOwnerEmail(request);
    if (server.status !== "active" && server.owner_email !== ownerEmail && !localPreview) return Response.json({ error: "not found" }, { status: 404 });
    const asset = await environment.DB.prepare(`SELECT object_key, content_type FROM server_description_assets
      WHERE id = ? AND server_id = ?`).bind(assetId, serverId).first<{ object_key: string; content_type: string }>();
    if (!asset) return Response.json({ error: "not found" }, { status: 404 });
    const object = await environment.MEDIA.get(asset.object_key);
    if (!object) return Response.json({ error: "not found" }, { status: 404 });
    return new Response(object.body, { headers: {
      "Content-Type": asset.content_type,
      "Content-Length": String(object.size),
      "Cache-Control": localPreview ? "no-cache" : "public, max-age=3600, stale-while-revalidate=86400",
      "ETag": object.httpEtag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { serverId, assetId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId) || !/^[a-f0-9]{32}$/.test(assetId)) return Response.json({ error: "invalid asset id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    if (!environment.MEDIA) return Response.json({ error: "media storage is not configured" }, { status: 503 });
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT owner_email, description_document FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<{ owner_email: string; description_document: string }>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    if (server.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (server.description_document.includes(assetId)) return Response.json({ error: "소개에서 포스터 블록을 제거하고 변경사항을 저장한 뒤 삭제해 주세요." }, { status: 409 });
    const asset = await environment.DB.prepare("SELECT object_key FROM server_description_assets WHERE id = ? AND server_id = ?")
      .bind(assetId, serverId).first<{ object_key: string }>();
    if (!asset) return Response.json({ error: "not found" }, { status: 404 });
    const deleted = await environment.DB.prepare(`DELETE FROM server_description_assets
      WHERE id = ? AND server_id = ?
        AND EXISTS (
          SELECT 1 FROM directory_servers guarded_server
          WHERE guarded_server.id = server_description_assets.server_id
            AND guarded_server.owner_email = ? AND guarded_server.deleted_at IS NULL
            AND guarded_server.owner_verification_status <> 'disputed'
            AND instr(guarded_server.description_document, ?) = 0
        )`).bind(assetId, serverId, ownerEmail, assetId).run();
    if ((deleted.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "서버 또는 포스터 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    await environment.MEDIA.delete(asset.object_key).catch(() => undefined);
    return new Response(null, { status: 204 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
