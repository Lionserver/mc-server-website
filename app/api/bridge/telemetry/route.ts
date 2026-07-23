import { authenticateBridgeRequest, boundedInteger, boundedText, bridgeEnv, errorResponse } from "@/lib/bridge-api";
import { assertAddressNotBlacklisted, assertNotBlacklisted, ensureAdminSchema } from "@/lib/admin-security";
import { ensurePublicDirectorySchema } from "@/lib/public-directory";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";

interface BackendPayload {
  id?: unknown;
  players?: unknown;
  maxPlayers?: unknown;
  online?: unknown;
  software?: unknown;
  version?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const server = await authenticateBridgeRequest(request, body);
    if (!server.verified_at) return Response.json({ error: "server ownership is not verified" }, { status: 403 });
    if (body.length > 256_000) return Response.json({ error: "payload too large" }, { status: 413 });
    const payload = JSON.parse(body) as Record<string, unknown>;
    const backends = Array.isArray(payload.backends) ? payload.backends as BackendPayload[] : [];
    if (backends.length > 100) return Response.json({ error: "at most 100 backends are accepted" }, { status: 400 });
    const platform = payload.platform === "velocity" ? "velocity" : payload.platform === "paper" ? "paper" : null;
    if (!platform) return Response.json({ error: "platform must be paper or velocity" }, { status: 400 });
    const totalPlayers = boundedInteger(payload.totalPlayers, "totalPlayers");
    const maxPlayers = boundedInteger(payload.maxPlayers, "maxPlayers");
    const averagePingMs = boundedInteger(payload.averagePingMs, "averagePingMs", 120_000);
    const software = boundedText(payload.software, "software");
    const version = boundedText(payload.version, "version");
    const pluginVersion = boundedText(payload.pluginVersion, "pluginVersion", 40);
    const normalized = backends.map((backend) => ({
      id: boundedText(backend.id, "backend.id", 80),
      players: boundedInteger(backend.players, "backend.players"),
      maxPlayers: boundedInteger(backend.maxPlayers, "backend.maxPlayers"),
      online: backend.online === true,
      software: boundedText(backend.software, "backend.software"),
      version: boundedText(backend.version, "backend.version"),
    }));

    const environment = await bridgeEnv();
    await ensureAdminSchema(environment.DB);
    await ensurePublicDirectorySchema(environment.DB);
    const now = Math.floor(Date.now() / 1000);
    const bucketAt = Math.floor(now / 300) * 300;
    const directoryServer = await environment.DB.prepare("SELECT id, resolved_ips FROM directory_servers WHERE bridge_server_id = ? AND deleted_at IS NULL")
      .bind(server.server_id).first<{ id: string; resolved_ips: string }>();
    if (!directoryServer) return Response.json({ error: "directory server not found" }, { status: 404 });
    let resolvedIps = parseIps(directoryServer.resolved_ips);
    try {
      if (Math.floor(now / 300) % 72 === 0) resolvedIps = await assertAddressNotBlacklisted(environment.DB, server.public_host, server.public_port);
      else {
        await assertNotBlacklisted(environment.DB, { address: server.public_host });
        for (const ip of resolvedIps) await assertNotBlacklisted(environment.DB, { ip });
      }
    } catch (error) {
      if (error instanceof Response && error.status === 403) {
        await environment.DB.prepare(`UPDATE directory_servers SET
          status_before_blacklist = CASE WHEN status = 'blacklisted' THEN status_before_blacklist ELSE status END,
          status = 'blacklisted', updated_at = ? WHERE id = ?`).bind(now, directoryServer.id).run();
      }
      throw error;
    }
    const statements = [environment.DB.prepare(`UPDATE bridge_servers SET platform = ?, last_seen_at = ?, total_players = ?, max_players = ?,
      backend_count = ?, average_ping_ms = ?, software = ?, version = ?, plugin_version = ?, updated_at = ? WHERE server_id = ?`)
      .bind(platform, now, totalPlayers, maxPlayers, normalized.length, averagePingMs, software, version, pluginVersion, now, server.server_id),
      environment.DB.prepare("DELETE FROM bridge_backends WHERE server_id = ?").bind(server.server_id),
      environment.DB.prepare(`INSERT INTO bridge_telemetry_history
        (server_id, bucket_at, total_players, max_players, average_ping_ms, online)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(server_id, bucket_at) DO UPDATE SET total_players = excluded.total_players,
          max_players = excluded.max_players, average_ping_ms = excluded.average_ping_ms, online = 1`)
        .bind(server.server_id, bucketAt, totalPlayers, maxPlayers, averagePingMs),
      environment.DB.prepare(`INSERT INTO server_status_history
        (server_id, bucket_at, players, max_players, latency_ms, online, source)
        VALUES (?, ?, ?, ?, ?, 1, 'bridge')
        ON CONFLICT(server_id, bucket_at) DO UPDATE SET players = excluded.players,
          max_players = excluded.max_players, latency_ms = excluded.latency_ms,
          online = 1, source = 'bridge'`)
        .bind(directoryServer.id, bucketAt, totalPlayers, maxPlayers, averagePingMs),
      environment.DB.prepare("DELETE FROM bridge_telemetry_history WHERE bucket_at < ?").bind(now - 35 * 86_400),
      environment.DB.prepare("DELETE FROM server_status_history WHERE bucket_at < ?").bind(now - 35 * 86_400),
      environment.DB.prepare("UPDATE directory_servers SET resolved_ips = ? WHERE id = ?").bind(JSON.stringify(resolvedIps), directoryServer.id),
    ];
    for (const backend of normalized) {
      statements.push(environment.DB.prepare(`INSERT INTO bridge_backends
        (server_id, backend_id, players, max_players, online, software, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(server.server_id, backend.id, backend.players, backend.maxPlayers, backend.online ? 1 : 0, backend.software, backend.version, now));
    }
    await environment.DB.batch(statements);
    await broadcastDirectoryUpdate(environment, directoryServer.id, now).catch(() => false);
    return Response.json({ accepted: true, serverId: server.server_id, backendCount: normalized.length, receivedAt: now });
  } catch (error) {
    return errorResponse(error);
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
