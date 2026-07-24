import { directoryEnv } from "@/lib/server-directory";

export async function GET() {
  const environment = await directoryEnv();
  const bridgeAdminReady = typeof (environment as { BRIDGE_ADMIN_TOKEN?: string }).BRIDGE_ADMIN_TOKEN === "string"
    && ((environment as { BRIDGE_ADMIN_TOKEN?: string }).BRIDGE_ADMIN_TOKEN?.length ?? 0) >= 24;
  const bridgeMasterReady = typeof environment.BRIDGE_MASTER_SECRET === "string"
    && environment.BRIDGE_MASTER_SECRET.length >= 32;
  const ready = bridgeAdminReady && bridgeMasterReady;
  return Response.json({
    service: "minecraft-kr-bridge",
    ok: ready,
    ready,
    protocolVersion: 1,
    checks: {
      database: Boolean(environment.DB),
      adminToken: bridgeAdminReady,
      masterSecret: bridgeMasterReady,
    },
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
