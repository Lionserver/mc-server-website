import { assetSpecs, validateAsset, type AssetKind } from "@/lib/image-assets";
import { ensureAdminSchema } from "@/lib/admin-security";
import { directoryEnv, directoryErrorResponse, ownerEmailFromRequest, type DirectoryServerRow } from "@/lib/server-directory";
import { assertSameOrigin } from "@/lib/user-auth";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { serverId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<DirectoryServerRow>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    if (server.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    const rows = await environment.DB.prepare(`SELECT kind, content_type, width, height, size, focus_x, focus_y, zoom_percent, updated_at
      FROM server_assets WHERE server_id = ? ORDER BY kind`).bind(serverId)
      .all<{ kind: AssetKind; content_type: string; width: number; height: number; size: number; focus_x: number; focus_y: number; zoom_percent: number; updated_at: number }>();
    return Response.json({
      assets: rows.results.map((asset) => ({
        kind: asset.kind,
        contentType: asset.content_type,
        width: asset.width,
        height: asset.height,
        size: asset.size,
        focusX: asset.focus_x,
        focusY: asset.focus_y,
        zoom: asset.zoom_percent,
        updatedAt: asset.updated_at,
        url: `/api/servers/${serverId}/assets/${asset.kind}`,
      })),
    });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { serverId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const body = await request.json() as { kind?: unknown; focusX?: unknown; focusY?: unknown; zoom?: unknown };
    if (typeof body.kind !== "string" || !(body.kind in assetSpecs)) {
      return Response.json({ error: "이미지 종류를 확인해 주세요." }, { status: 400 });
    }
    const kind = body.kind as AssetKind;
    const focusX = Number(body.focusX);
    const focusY = Number(body.focusY);
    const zoom = Number(body.zoom);
    if (![focusX, focusY, zoom].every(Number.isInteger) || focusX < 0 || focusX > 100 || focusY < 0 || focusY > 100 || zoom < 100 || zoom > 300) {
      return Response.json({ error: "움직임 크롭값을 확인해 주세요." }, { status: 400 });
    }
    const environment = await directoryEnv();
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<DirectoryServerRow>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    if (server.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (server.owner_verification_status === "disputed") return Response.json({ error: "소유권 심사 중에는 이미지를 변경할 수 없습니다." }, { status: 423 });
    const now = Math.floor(Date.now() / 1000);
    const updated = await environment.DB.prepare(`UPDATE server_assets SET focus_x = ?, focus_y = ?, zoom_percent = ?, updated_at = ?
      WHERE server_id = ? AND kind = ? AND content_type IN ('image/gif', 'video/webm')`).bind(focusX, focusY, zoom, now, serverId, kind).run();
    if (!updated.meta.changes) return Response.json({ error: "먼저 움직이는 이미지를 등록해 주세요." }, { status: 404 });
    if (server.status === "active") await broadcastDirectoryUpdate(environment, serverId, now).catch(() => false);
    return Response.json({ asset: { kind, focusX, focusY, zoom, updatedAt: now } });
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
    await ensureAdminSchema(environment.DB);
    const server = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<DirectoryServerRow>();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    if (server.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (server.owner_verification_status === "disputed") return Response.json({ error: "소유권 심사 중에는 이미지를 변경할 수 없습니다." }, { status: 423 });

    const form = await request.formData();
    const kinds = Object.keys(assetSpecs) as AssetKind[];
    const validated: Array<{ kind: AssetKind } & Awaited<ReturnType<typeof validateAsset>>> = [];
    for (const kind of kinds) {
      const value = form.get(kind);
      if (!(value instanceof File)) continue;
      validated.push({ kind, ...(await validateAsset(value, kind)) });
    }
    if (validated.length === 0) return Response.json({ error: "select at least one image to replace" }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const statements = [];
    const previous = await environment.DB.prepare("SELECT kind, object_key FROM server_assets WHERE server_id = ?")
      .bind(serverId).all<{ kind: AssetKind; object_key: string }>();
    const previousKeys = new Map(previous.results.map((asset) => [asset.kind, asset.object_key]));
    const nextKeys = new Map<AssetKind, string>();
    try {
      for (const asset of validated) {
        const objectKey = `servers/${serverId}/${asset.kind}/${now}-${crypto.randomUUID().replaceAll("-", "")}.${asset.extension}`;
        nextKeys.set(asset.kind, objectKey);
        await environment.MEDIA.put(objectKey, asset.bytes, { httpMetadata: { contentType: asset.file.type }, customMetadata: { ownerEmail, serverId, kind: asset.kind } });
        statements.push(environment.DB.prepare(`INSERT INTO server_assets
          (server_id, kind, object_key, content_type, width, height, size, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(server_id, kind) DO UPDATE SET object_key = excluded.object_key, content_type = excluded.content_type,
          width = excluded.width, height = excluded.height, size = excluded.size, updated_at = excluded.updated_at`)
          .bind(serverId, asset.kind, objectKey, asset.file.type, asset.width, asset.height, asset.file.size, now));
      }
      await environment.DB.batch(statements);
    } catch (error) {
      await Promise.all([...nextKeys.values()].map((objectKey) => environment.MEDIA?.delete(objectKey).catch(() => undefined)));
      throw error;
    }
    await Promise.all(validated.map((asset) => {
      const previousKey = previousKeys.get(asset.kind);
      const nextKey = nextKeys.get(asset.kind);
      return previousKey && previousKey !== nextKey ? environment.MEDIA?.delete(previousKey) : undefined;
    }));
    if (server.status === "active") await broadcastDirectoryUpdate(environment, serverId, now).catch(() => false);
    return Response.json({ uploaded: validated.map(({ kind, width, height, file }) => ({ kind, width, height, size: file.size })) });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
