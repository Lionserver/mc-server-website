import { bridgeEnv, ensureBridgeSchema, errorResponse } from "@/lib/bridge-api";
import { ownerEmailFromRequest } from "@/lib/server-directory";

export async function GET(request: Request) {
  try {
    const serverId = new URL(request.url).searchParams.get("serverId") ?? "";
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(serverId)) return Response.json({ error: "invalid serverId" }, { status: 400 });
    const environment = await bridgeEnv();
    await ensureBridgeSchema(environment.DB);
    const ownerEmail = await ownerEmailFromRequest(request);
    const owned = await environment.DB.prepare(`SELECT 1 owned FROM directory_servers
      WHERE bridge_server_id = ? AND owner_email = ? AND deleted_at IS NULL LIMIT 1`).bind(serverId, ownerEmail).first();
    if (!owned) return Response.json({ error: "not found" }, { status: 404 });
    const server = await environment.DB.prepare(`SELECT server_id, platform, public_host, public_port, verified_at, last_seen_at,
      total_players, max_players, backend_count, average_ping_ms, software, version, plugin_version, updated_at
      FROM bridge_servers WHERE server_id = ?`).bind(serverId).first();
    if (!server) return Response.json({ error: "not found" }, { status: 404 });
    const backends = await environment.DB.prepare(`SELECT backend_id, players, max_players, online, software, version, updated_at
      FROM bridge_backends WHERE server_id = ? ORDER BY backend_id`).bind(serverId).all();
    return Response.json({ server, backends: backends.results });
  } catch (error) {
    return errorResponse(error);
  }
}
