import { authenticateBridgeRequest, bridgeEnv, errorResponse, hashHex } from "@/lib/bridge-api";
import { pingMinecraftServer } from "@/lib/minecraft-ping";
import { assertAddressNotBlacklisted, ensureAdminSchema } from "@/lib/admin-security";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";
import { ensurePublicDirectorySchema } from "@/lib/public-directory";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const server = await authenticateBridgeRequest(request, body);
    const payload = JSON.parse(body) as { verificationToken?: unknown };
    const token = typeof payload.verificationToken === "string" ? payload.verificationToken : "";
    const now = Math.floor(Date.now() / 1000);
    if (!token || now > server.challenge_expires_at || await hashHex(token) !== server.challenge_hash) {
      return Response.json({ error: "invalid or expired verification token" }, { status: 400 });
    }

    const environment = await bridgeEnv();
    await ensureAdminSchema(environment.DB);
    await ensurePublicDirectorySchema(environment.DB);
    const resolvedIps = await assertAddressNotBlacklisted(environment.DB, server.public_host, server.public_port);
    const ping = await pingMinecraftServer(server.public_host, server.public_port, environment.ALLOW_PRIVATE_BRIDGE_VERIFY === "true");
    if (!ping.descriptionText.includes(`[MKR-VERIFY:${token}]`)) {
      return Response.json({ error: "verification marker was not found in the live server MOTD", observedMotd: ping.descriptionText }, { status: 422 });
    }
    const directoryServer = await environment.DB.prepare("SELECT id FROM directory_servers WHERE bridge_server_id = ? AND deleted_at IS NULL")
      .bind(server.server_id).first<{ id: string }>();
    await environment.DB.batch([
      environment.DB.prepare(`UPDATE bridge_servers SET verified_at = ?, last_ping_attempt_at = ?, last_ping_success_at = ?,
        ping_players = ?, ping_max_players = ?, ping_latency_ms = ?, ping_version = ?, updated_at = ? WHERE server_id = ?`)
        .bind(now, now, now, ping.playersOnline, ping.playersMax, ping.latencyMs, ping.version, now, server.server_id),
      environment.DB.prepare(`UPDATE directory_servers SET status = 'active', owner_verification_status = 'verified',
        owner_verified_at = ?, resolved_ips = ?, updated_at = ? WHERE bridge_server_id = ? AND deleted_at IS NULL`)
        .bind(now, JSON.stringify(resolvedIps), now, server.server_id),
      ...(directoryServer ? [environment.DB.prepare(`INSERT INTO server_status_history
        (server_id, bucket_at, players, max_players, latency_ms, online, source) VALUES (?, ?, ?, ?, ?, 1, 'ping')
        ON CONFLICT(server_id, bucket_at) DO UPDATE SET players = excluded.players, max_players = excluded.max_players,
          latency_ms = excluded.latency_ms, online = 1, source = excluded.source
        WHERE server_status_history.source <> 'bridge'`)
        .bind(directoryServer.id, Math.floor(now / 300) * 300, ping.playersOnline, ping.playersMax, ping.latencyMs)] : []),
    ]);
    if (directoryServer) await broadcastDirectoryUpdate(environment, directoryServer.id, now).catch(() => false);
    return Response.json({ verified: true, serverId: server.server_id, ping });
  } catch (error) {
    return errorResponse(error);
  }
}
