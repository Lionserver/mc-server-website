import { ensureAdminSchema } from "@/lib/admin-security";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";
import { validateDescriptionPoster } from "@/lib/image-assets";
import { directoryEnv, directoryErrorResponse, ownerEmailFromRequest, type DirectoryServerRow } from "@/lib/server-directory";
import { assertSameOrigin } from "@/lib/user-auth";
import { assertRequestContentLength, assertStorageQuota, assertUploadAllowed } from "@/lib/request-guards";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { serverId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT owner_email FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<{ owner_email: string }>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    if (server.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    const assets = await environment.DB.prepare(`SELECT id, content_type, width, height, size, created_at
      FROM server_description_assets WHERE server_id = ? ORDER BY created_at DESC`).bind(serverId)
      .all<{ id: string; content_type: string; width: number; height: number; size: number; created_at: number }>();
    return Response.json({ assets: assets.results.map((asset) => ({
      id: asset.id, contentType: asset.content_type, width: asset.width, height: asset.height, size: asset.size,
      createdAt: asset.created_at, url: `/api/servers/${serverId}/description-assets/${asset.id}`,
    })) }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, OAI-Authenticated-User-Email" } });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { serverId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    if (!environment.MEDIA) return Response.json({ error: "media storage is not configured" }, { status: 503 });
    assertRequestContentLength(request, 9 * 1024 * 1024);
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<DirectoryServerRow>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    if (server.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (server.owner_verification_status === "disputed") return Response.json({ error: "소유권 심사 중에는 포스터를 변경할 수 없습니다." }, { status: 423 });
    await assertUploadAllowed(environment.DB, request, ownerEmail);
    const count = await environment.DB.prepare("SELECT COUNT(*) count FROM server_description_assets WHERE server_id = ?")
      .bind(serverId).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 12) return Response.json({ error: "소개 포스터는 서버당 최대 12장까지 보관할 수 있습니다. 사용하지 않는 포스터를 저장에서 제외해 주세요." }, { status: 409 });
    const form = await request.formData();
    const file = form.get("poster");
    if (!(file instanceof File)) return Response.json({ error: "등록할 홍보 포스터를 선택해 주세요." }, { status: 400 });
    const poster = await validateDescriptionPoster(file);
    await assertStorageQuota(environment.DB, ownerEmail, serverId, poster.file.size);
    const id = crypto.randomUUID().replaceAll("-", "");
    const now = Math.floor(Date.now() / 1000);
    const objectKey = `servers/${serverId}/description/${id}.${poster.extension}`;
    await environment.MEDIA.put(objectKey, poster.bytes, {
      httpMetadata: { contentType: poster.file.type },
      customMetadata: { ownerEmail, serverId, assetId: id, purpose: "server-description-poster" },
    });
    try {
      await environment.DB.prepare(`INSERT INTO server_description_assets
        (id, server_id, object_key, content_type, width, height, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, serverId, objectKey, poster.file.type, poster.width, poster.height, poster.file.size, now).run();
    } catch (error) {
      await environment.MEDIA.delete(objectKey).catch(() => undefined);
      throw error;
    }
    if (server.status === "active") await broadcastDirectoryUpdate(environment, serverId, now).catch(() => false);
    return Response.json({ asset: {
      id, contentType: poster.file.type, width: poster.width, height: poster.height, size: poster.file.size,
      createdAt: now, url: `/api/servers/${serverId}/description-assets/${id}`,
    } }, { status: 201 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
