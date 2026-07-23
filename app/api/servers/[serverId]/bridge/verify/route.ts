import { ensureBridgeSchema, errorResponse, hashHex, type BridgeEnv } from "@/lib/bridge-api";
import { assertAddressNotBlacklisted, ensureAdminSchema } from "@/lib/admin-security";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";
import { pingMinecraftServer } from "@/lib/minecraft-ping";
import { ensurePublicDirectorySchema } from "@/lib/public-directory";
import { directoryEnv, ownerEmailFromRequest } from "@/lib/server-directory";
import { assertSameOrigin } from "@/lib/user-auth";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

type OwnerBridgeRow = {
  id: string;
  status: string;
  owner_verification_status: string;
  bridge_server_id: string | null;
  address: string;
  port: number;
  challenge_hash: string | null;
  challenge_expires_at: number | null;
  verified_at: number | null;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { serverId: directoryServerId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(directoryServerId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const payload = await request.json().catch(() => ({})) as { verificationToken?: unknown };
    const token = typeof payload.verificationToken === "string" ? payload.verificationToken.trim() : "";
    const environment = await directoryEnv() as BridgeEnv;
    await ensureAdminSchema(environment.DB);
    await ensureBridgeSchema(environment.DB);
    await ensurePublicDirectorySchema(environment.DB);

    const server = await environment.DB.prepare(`SELECT d.id, d.status, d.owner_verification_status, d.bridge_server_id,
      d.address, d.port, b.challenge_hash, b.challenge_expires_at, b.verified_at
      FROM directory_servers d LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
      WHERE d.id = ? AND d.owner_email = ? AND d.deleted_at IS NULL`)
      .bind(directoryServerId, ownerEmail).first<OwnerBridgeRow>();
    if (!server) return Response.json({ error: "관리 권한이 있는 서버를 찾을 수 없습니다." }, { status: 404 });
    if (server.owner_verification_status === "disputed") {
      return Response.json({ error: "소유권 심사 중에는 MOTD 인증을 진행할 수 없습니다." }, { status: 423 });
    }
    if (server.status === "active" && server.owner_verification_status === "verified" && server.verified_at) {
      return Response.json({ verified: true, alreadyVerified: true, serverId: server.bridge_server_id });
    }
    if (!server.bridge_server_id || !server.challenge_hash || !server.challenge_expires_at) {
      return Response.json({ error: "먼저 MOTD 인증 문자열을 발급해 주세요." }, { status: 409 });
    }

    const now = Math.floor(Date.now() / 1000);
    if (!token || now > server.challenge_expires_at || await hashHex(token) !== server.challenge_hash) {
      return Response.json({ error: "인증 문자열이 만료되었거나 일치하지 않습니다. 새 문자열을 발급해 다시 시도해 주세요." }, { status: 400 });
    }

    const resolvedIps = await assertAddressNotBlacklisted(environment.DB, server.address, server.port);
    const ping = await pingMinecraftServer(server.address, server.port, environment.ALLOW_PRIVATE_BRIDGE_VERIFY === "true");
    const marker = `[MKR-VERIFY:${token}]`;
    if (!ping.descriptionText.includes(marker)) {
      return Response.json({
        error: "실제 서버 MOTD에서 인증 문자열을 찾지 못했습니다. 문자열 적용과 서버 재시작을 확인해 주세요.",
        observedMotd: ping.descriptionText,
      }, { status: 422 });
    }

    await environment.DB.batch([
      environment.DB.prepare(`UPDATE bridge_servers SET verified_at = ?, last_ping_attempt_at = ?, last_ping_success_at = ?,
        ping_players = ?, ping_max_players = ?, ping_latency_ms = ?, ping_version = ?, updated_at = ? WHERE server_id = ?`)
        .bind(now, now, now, ping.playersOnline, ping.playersMax, ping.latencyMs, ping.version, now, server.bridge_server_id),
      environment.DB.prepare(`UPDATE directory_servers SET status = 'active', owner_verification_status = 'verified',
        owner_verified_at = ?, resolved_ips = ?, updated_at = ? WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`)
        .bind(now, JSON.stringify(resolvedIps), now, directoryServerId, ownerEmail),
      environment.DB.prepare(`INSERT INTO server_status_history
        (server_id, bucket_at, players, max_players, latency_ms, online, source) VALUES (?, ?, ?, ?, ?, 1, 'ping')
        ON CONFLICT(server_id, bucket_at) DO UPDATE SET players = excluded.players, max_players = excluded.max_players,
          latency_ms = excluded.latency_ms, online = 1, source = excluded.source
        WHERE server_status_history.source <> 'bridge'`)
        .bind(directoryServerId, Math.floor(now / 300) * 300, ping.playersOnline, ping.playersMax, ping.latencyMs),
    ]);
    await broadcastDirectoryUpdate(environment, directoryServerId, now).catch(() => false);
    return Response.json({ verified: true, serverId: server.bridge_server_id, ping });
  } catch (error) {
    return errorResponse(error);
  }
}
