import { deriveBridgeSecret, ensureBridgeSchema, hashHex } from "@/lib/bridge-api";
import { assertAddressNotBlacklisted, ensureAdminSchema } from "@/lib/admin-security";
import {
  directoryEnv, directoryErrorResponse, ownerEmailFromRequest,
  serializeDirectoryServer, staffProfilesByServer, type DirectoryServerRow,
} from "@/lib/server-directory";
import { assertSameOrigin } from "@/lib/user-auth";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { serverId: directoryServerId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(directoryServerId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    await ensureAdminSchema(environment.DB);
    await ensureBridgeSchema(environment.DB);
    const bridge = await environment.DB.prepare(`SELECT b.server_id, b.platform, b.public_host, b.public_port,
      b.challenge_expires_at, b.verified_at FROM directory_servers d
      JOIN bridge_servers b ON b.server_id = d.bridge_server_id
      WHERE d.id = ? AND d.owner_email = ? AND d.deleted_at IS NULL`)
      .bind(directoryServerId, ownerEmail).first<{
        server_id: string; platform: "paper" | "velocity"; public_host: string; public_port: number;
        challenge_expires_at: number; verified_at: number | null;
      }>();
    if (!bridge) return Response.json({ error: "발급된 브리지 연결 정보를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({
      bridge: {
        serverId: bridge.server_id,
        bridgeSecret: await deriveBridgeSecret(bridge.server_id),
        verificationToken: "",
        expiresAt: bridge.challenge_expires_at,
        platform: bridge.platform,
        publicHost: bridge.public_host,
        publicPort: bridge.public_port,
        apiBaseUrl: new URL("/api/bridge", request.url).toString().replace(/\/$/, ""),
        verified: Boolean(bridge.verified_at),
      },
    });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { serverId: directoryServerId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(directoryServerId)) return Response.json({ error: "invalid server id" }, { status: 400 });
    const ownerEmail = await ownerEmailFromRequest(request);
    const payload = await request.json().catch(() => ({})) as { platform?: unknown };
    const platform = payload.platform === "velocity" ? "velocity" : "paper";
    const environment = await directoryEnv();
    await ensureAdminSchema(environment.DB);
    await ensureBridgeSchema(environment.DB);
    const directoryServer = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(directoryServerId).first<DirectoryServerRow>();
    if (!directoryServer) return Response.json({ error: "not found" }, { status: 404 });
    if (directoryServer.owner_email !== ownerEmail) return Response.json({ error: "forbidden" }, { status: 403 });
    if (directoryServer.owner_verification_status === "disputed") return Response.json({ error: "소유권 심사 중에는 브리지 키를 발급할 수 없습니다." }, { status: 423 });
    if (directoryServer.status === "active" && directoryServer.owner_verification_status === "verified") {
      return Response.json({ error: "이미 소유권 인증이 완료된 서버입니다." }, { status: 409 });
    }
    const resolvedIps = await assertAddressNotBlacklisted(environment.DB, directoryServer.address, directoryServer.port);

    const bridgeServerId = directoryServer.bridge_server_id ?? crypto.randomUUID().replaceAll("-", "");
    const verificationToken = `mkr_${crypto.randomUUID().replaceAll("-", "")}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600;
    const challengeHash = await hashHex(verificationToken);
    const existingBridge = directoryServer.bridge_server_id
      ? await environment.DB.prepare("SELECT server_id FROM bridge_servers WHERE server_id = ?")
        .bind(directoryServer.bridge_server_id).first<{ server_id: string }>()
      : null;
    const bridgeWrite = existingBridge
      ? environment.DB.prepare(`UPDATE bridge_servers SET platform = ?, public_host = ?, public_port = ?, challenge_hash = ?,
          challenge_expires_at = ?, verified_at = NULL, updated_at = ? WHERE server_id = ?`)
        .bind(platform, directoryServer.address, directoryServer.port, challengeHash, expiresAt, now, bridgeServerId)
      : environment.DB.prepare(`INSERT INTO bridge_servers
          (server_id, platform, public_host, public_port, challenge_hash, challenge_expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`) 
        .bind(bridgeServerId, platform, directoryServer.address, directoryServer.port, challengeHash, expiresAt, now, now);
    await environment.DB.batch([
      bridgeWrite,
      environment.DB.prepare(`UPDATE directory_servers SET bridge_server_id = ?, status = 'pending_verification', resolved_ips = ?,
        owner_verification_status = 'verifying', owner_verified_at = NULL, updated_at = ?
        WHERE id = ? AND owner_email = ?`).bind(bridgeServerId, JSON.stringify(resolvedIps), now, directoryServerId, ownerEmail),
    ]);
    const updated = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ?").bind(directoryServerId).first<DirectoryServerRow>();
    const staff = await staffProfilesByServer(environment.DB, [directoryServerId]);
    return Response.json({
      server: serializeDirectoryServer(updated as DirectoryServerRow, staff.get(directoryServerId) ?? []),
      bridge: {
        serverId: bridgeServerId,
        bridgeSecret: await deriveBridgeSecret(bridgeServerId),
        verificationToken,
        expiresAt,
        platform,
        publicHost: directoryServer.address,
        publicPort: directoryServer.port,
        apiBaseUrl: new URL("/api/bridge", request.url).toString().replace(/\/$/, ""),
        reissued: Boolean(existingBridge),
        verified: false,
      },
    }, { status: existingBridge ? 200 : 201 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
