import {
  directoryEnv, directoryErrorResponse, optionalOwnerEmail, ownerEmailFromRequest,
  parseDirectoryInput, serializeDirectoryServer, staffProfilesByServer, type DirectoryServerRow,
} from "@/lib/server-directory";
import { assertAddressNotBlacklisted } from "@/lib/admin-security";
import { ensureOwnershipSchema } from "@/lib/server-ownership";
import { ensurePremiumAuctionSchema } from "@/lib/premium-auction";
import { assertSameOrigin } from "@/lib/user-auth";
import { ensurePublicDirectorySchema, normalizePublicUrl, parseStaffProfiles, publicServerDetail } from "@/lib/public-directory";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";
import { descriptionPlainText, descriptionPosterIds, parseDescriptionDocument } from "@/lib/server-description";
import { MinecraftProfileLookupError, resolveMinecraftProfiles } from "@/lib/minecraft-profile";
import { ensureOperatorChannelSchema } from "@/lib/operator-channel";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

async function serverIdFrom(context: RouteContext) {
  const { serverId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "invalid server id" }, { status: 400 });
  return serverId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const id = await serverIdFrom(context);
    const environment = await directoryEnv();
    await ensurePublicDirectorySchema(environment.DB);
    const row = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<DirectoryServerRow>();
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    const owner = await optionalOwnerEmail(request);
    if (row.status !== "active" && owner !== row.owner_email) return Response.json({ error: "not found" }, { status: 404 });
    const publicMode = new URL(request.url).searchParams.get("public") === "1";
    if (row.status === "active" && (publicMode || owner !== row.owner_email)) {
      const server = await publicServerDetail(environment.DB, id);
      return server ? Response.json({ server }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "not found" }, { status: 404 });
    }
    const staff = await staffProfilesByServer(environment.DB, [id]);
    return Response.json({ server: serializeDirectoryServer(row, staff.get(id) ?? []) }, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, OAI-Authenticated-User-Email" },
    });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const id = await serverIdFrom(context);
    const ownerEmail = await ownerEmailFromRequest(request);
    const payload = await request.json();
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (typeof body.descriptionDocument === "string") throw Response.json({ error: "HTML·소스 문자열은 소개 문서로 저장할 수 없습니다. 소개 에디터 블록을 사용해 주세요." }, { status: 400 });
    let descriptionDocument;
    try { descriptionDocument = parseDescriptionDocument(body.descriptionDocument, typeof body.description === "string" ? body.description : ""); }
    catch (error) { throw Response.json({ error: error instanceof Error ? error.message : "서버 소개 문서를 확인해 주세요." }, { status: 400 }); }
    const description = descriptionPlainText(descriptionDocument);
    const input = parseDirectoryInput({ ...body, description });
    const posterIds = descriptionPosterIds(descriptionDocument);
    const discordEnabled = body.discordEnabled === true;
    const discordUrl = normalizePublicUrl(body.discordUrl, "Discord");
    const websiteEnabled = body.websiteEnabled === true;
    const websiteUrl = normalizePublicUrl(body.websiteUrl, "웹사이트");
    const kakaoEnabled = body.kakaoEnabled === true;
    const kakaoUrl = normalizePublicUrl(body.kakaoUrl, "카카오톡");
    if (discordEnabled && !discordUrl) throw Response.json({ error: "Discord 공개 링크를 입력해 주세요." }, { status: 400 });
    if (websiteEnabled && !websiteUrl) throw Response.json({ error: "서버 전용 웹사이트 링크를 입력해 주세요." }, { status: 400 });
    if (kakaoEnabled && !kakaoUrl) throw Response.json({ error: "카카오톡 공개 링크를 입력해 주세요." }, { status: 400 });
    const staffIntroEnabled = body.staffIntroEnabled === true;
    const staff = parseStaffProfiles(body.staff);
    if (staffIntroEnabled && staff.length === 0) {
      return Response.json({ error: "운영진 소개를 공개하려면 운영진을 1명 이상 입력해 주세요." }, { status: 400 });
    }
    const environment = await directoryEnv();
    await ensurePublicDirectorySchema(environment.DB);
    await ensurePremiumAuctionSchema(environment.DB);
    const existing = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<DirectoryServerRow>();
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    if (existing.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (existing.status === "blacklisted") return Response.json({ error: "블랙리스트 차단 중인 서버는 수정할 수 없습니다." }, { status: 403 });
    if (existing.owner_verification_status === "disputed") return Response.json({ error: "소유권 심사 중에는 서버 정보를 수정할 수 없습니다." }, { status: 423 });
    if (posterIds.length) {
      const placeholders = posterIds.map(() => "?").join(",");
      const ownedPosters = await environment.DB.prepare(`SELECT COUNT(*) count FROM server_description_assets
        WHERE server_id = ? AND id IN (${placeholders})`).bind(id, ...posterIds).first<{ count: number }>();
      if (Number(ownedPosters?.count ?? 0) !== posterIds.length) return Response.json({ error: "다른 서버의 포스터이거나 삭제된 포스터가 소개에 포함되어 있습니다." }, { status: 400 });
    }
    if (existing.address.toLowerCase() !== input.address.toLowerCase()) {
      return Response.json({ error: "서버 주소는 변경할 수 없으며 대소문자 표시만 바꿀 수 있습니다." }, { status: 400 });
    }
    const duplicate = await environment.DB.prepare(`SELECT id FROM directory_servers
      WHERE lower(address) = ? AND port = ? AND id <> ? AND deleted_at IS NULL`).bind(input.address.toLowerCase(), input.port, id).first();
    if (duplicate) return Response.json({ error: "this server address is already registered" }, { status: 409 });
    const endpointChanged = existing.port !== input.port;
    if (endpointChanged && await hasFinancialLock(environment.DB, id)) {
      return Response.json({ error: "진행 중인 입찰·낙찰·프리미엄 광고가 있어 서버 포트를 변경할 수 없습니다." }, { status: 409 });
    }
    let resolvedStaff = staff;
    try {
      const profiles = await resolveMinecraftProfiles(environment.DB, staff.map((member) => member.nickname));
      resolvedStaff = staff.map((member) => {
        const profile = profiles.get(member.nickname.toLowerCase());
        if (!profile) throw new MinecraftProfileLookupError("unavailable", member.nickname);
        return { ...member, nickname: profile.name, minecraftUuid: profile.uuid };
      });
    } catch (error) {
      if (error instanceof MinecraftProfileLookupError) {
        const message = error.code === "not_found"
          ? `${error.nickname} 닉네임의 Minecraft Java 계정을 찾지 못했습니다.`
          : error.code === "invalid"
            ? `${error.nickname} 닉네임 형식을 확인해 주세요.`
            : "Minecraft 계정 확인이 지연되고 있습니다. 잠시 후 다시 저장해 주세요.";
        throw Response.json({ error: message }, { status: error.code === "unavailable" ? 503 : 400 });
      }
      throw error;
    }
    const resolvedIps = endpointChanged ? await assertAddressNotBlacklisted(environment.DB, input.address) : parseIps(existing.resolved_ips);
    const now = Math.floor(Date.now() / 1000);
    const status = endpointChanged ? "draft" : existing.status;
    const bridgeServerId = endpointChanged ? null : existing.bridge_server_id;
    const descriptionAssets = await environment.DB.prepare("SELECT id, object_key FROM server_description_assets WHERE server_id = ?")
      .bind(id).all<{ id: string; object_key: string }>();
    const unusedDescriptionAssets = descriptionAssets.results.filter((asset) => !posterIds.includes(asset.id));
    const statements = [environment.DB.prepare(`UPDATE directory_servers SET title = ?, short_description = ?, description = ?, description_document = ?, edition = ?,
      min_version = ?, max_version = ?, address = ?, port = ?, categories = ?, status = ?, bridge_server_id = ?,
      owner_verification_status = ?, owner_verified_at = ?, discord_url = ?, discord_enabled = ?, website_url = ?, website_enabled = ?,
      kakao_url = ?, kakao_enabled = ?, staff_intro_enabled = ?,
      resolved_ips = ?, updated_at = ?
      WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`)
      .bind(input.title, input.shortDescription, input.description, JSON.stringify(descriptionDocument), input.edition, input.minVersion, input.maxVersion,
        input.address, input.port, JSON.stringify(input.categories), status, bridgeServerId,
        endpointChanged ? "unverified" : existing.owner_verification_status, endpointChanged ? null : existing.owner_verified_at,
        discordUrl, discordEnabled ? 1 : 0, websiteUrl, websiteEnabled ? 1 : 0,
        kakaoUrl, kakaoEnabled ? 1 : 0, staffIntroEnabled ? 1 : 0, JSON.stringify(resolvedIps), now, id, ownerEmail),
      environment.DB.prepare("DELETE FROM server_staff_profiles WHERE server_id = ?").bind(id),
      ...unusedDescriptionAssets.map((asset) => environment.DB.prepare("DELETE FROM server_description_assets WHERE id = ? AND server_id = ?").bind(asset.id, id)),
      ...resolvedStaff.map((member, index) => environment.DB.prepare(`INSERT INTO server_staff_profiles
        (id, server_id, sort_order, role, nickname, minecraft_uuid, introduction, discord_enabled, discord_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID().replaceAll("-", ""), id, index, member.role, member.nickname, member.minecraftUuid, member.introduction,
          member.discordEnabled ? 1 : 0, member.discordUrl, now, now)),
    ];
    if (endpointChanged && existing.bridge_server_id) {
      statements.push(
        environment.DB.prepare("DELETE FROM bridge_backends WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_nonces WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_telemetry_history WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_servers WHERE server_id = ?").bind(existing.bridge_server_id),
      );
    }
    await environment.DB.batch(statements);
    if (environment.MEDIA && unusedDescriptionAssets.length) {
      await Promise.all(unusedDescriptionAssets.map((asset) => environment.MEDIA?.delete(asset.object_key).catch(() => undefined)));
    }
    if (status === "active") await broadcastDirectoryUpdate(environment, id, now).catch(() => false);
    const row = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ?").bind(id).first<DirectoryServerRow>();
    const nextStaff = await staffProfilesByServer(environment.DB, [id]);
    return Response.json({ server: serializeDirectoryServer(row as DirectoryServerRow, nextStaff.get(id) ?? []), ownershipReset: endpointChanged });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const id = await serverIdFrom(context);
    const ownerEmail = await ownerEmailFromRequest(request);
    const payload = await request.json().catch(() => ({})) as { confirmation?: unknown };
    const environment = await directoryEnv();
    await ensurePublicDirectorySchema(environment.DB);
    await ensureOwnershipSchema(environment.DB);
    await ensureOperatorChannelSchema(environment.DB);
    const existing = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<DirectoryServerRow>();
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    if (existing.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (existing.owner_verification_status === "disputed") return Response.json({ error: "소유권 심사 중에는 서버를 삭제할 수 없습니다." }, { status: 423 });
    if (await hasFinancialLock(environment.DB, id)) return Response.json({ error: "진행 중인 입찰·낙찰·프리미엄 광고가 있어 서버를 삭제할 수 없습니다." }, { status: 409 });
    if (payload.confirmation !== existing.title) return Response.json({ error: "type the exact server title to delete" }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const assets = await environment.DB.prepare(`SELECT object_key FROM server_assets WHERE server_id = ?
      UNION ALL SELECT object_key FROM server_description_assets WHERE server_id = ?`).bind(id, id).all<{ object_key: string }>();
    const statements = [
      environment.DB.prepare("DELETE FROM server_assets WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_description_assets WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_staff_profiles WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_votes WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM admin_messages WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM operator_channel_messages WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM admin_conversations WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM chat_realtime_tickets WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_ownership_transfers WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_ownership_claims WHERE server_id = ?").bind(id),
      environment.DB.prepare("UPDATE directory_servers SET deleted_at = ?, status = 'deleted', bridge_server_id = NULL, updated_at = ? WHERE id = ? AND owner_email = ?")
        .bind(now, now, id, ownerEmail),
    ];
    if (existing.bridge_server_id) {
      statements.unshift(
        environment.DB.prepare("DELETE FROM bridge_backends WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_nonces WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_telemetry_history WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_servers WHERE server_id = ?").bind(existing.bridge_server_id),
      );
    }
    await environment.DB.batch(statements);
    await broadcastDirectoryUpdate(environment, id, now).catch(() => false);
    if (environment.MEDIA) await Promise.all(assets.results.map((asset) => environment.MEDIA?.delete(asset.object_key).catch(() => undefined)));
    return new Response(null, { status: 204 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

function parseIps(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function hasFinancialLock(db: D1Database, serverId: string) {
  return Boolean(await db.prepare(`SELECT 1 locked FROM premium_bids WHERE server_id = ? AND status IN ('active', 'winner_pending', 'winner')
    UNION ALL SELECT 1 FROM premium_awards WHERE server_id = ? AND status IN ('payment_pending', 'scheduled', 'active')
    UNION ALL SELECT 1 FROM premium_placements WHERE server_id = ? AND status IN ('scheduled', 'active') LIMIT 1`)
    .bind(serverId, serverId, serverId).first());
}
