import { bridgeEnv, deriveBridgeSecret, ensureBridgeSchema, errorResponse, hashHex } from "@/lib/bridge-api";
import { assertNotBlacklisted, ensureAdminSchema } from "@/lib/admin-security";

export async function POST(request: Request) {
  try {
    const environment = await bridgeEnv();
    if (!environment.BRIDGE_ADMIN_TOKEN || request.headers.get("Authorization") !== `Bearer ${environment.BRIDGE_ADMIN_TOKEN}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const payload = await request.json() as { publicHost?: unknown; publicPort?: unknown; platform?: unknown };
    const publicHost = typeof payload.publicHost === "string" ? payload.publicHost.trim() : "";
    const publicPort = Number(payload.publicPort);
    const platform = payload.platform === "velocity" ? "velocity" : "paper";
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(publicHost)) return Response.json({ error: "invalid publicHost" }, { status: 400 });
    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) return Response.json({ error: "invalid publicPort" }, { status: 400 });

    const serverId = crypto.randomUUID().replaceAll("-", "");
    const verificationToken = `mkr_${crypto.randomUUID().replaceAll("-", "")}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600;
    await ensureAdminSchema(environment.DB);
    await assertNotBlacklisted(environment.DB, { address: publicHost, ip: publicHost });
    await ensureBridgeSchema(environment.DB);
    await environment.DB.prepare(`INSERT INTO bridge_servers
      (server_id, platform, public_host, public_port, challenge_hash, challenge_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(serverId, platform, publicHost, publicPort, await hashHex(verificationToken), expiresAt, now, now).run();

    return Response.json({
      serverId,
      bridgeSecret: await deriveBridgeSecret(serverId),
      verificationToken,
      expiresAt,
      config: {
        apiBaseUrl: new URL("/api/bridge", request.url).toString().replace(/\/$/, ""),
        publicHost,
        publicPort,
        platform,
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
