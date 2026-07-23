import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import { chatRealtimeEnv, issueChatRealtimeTicket } from "@/lib/chat-realtime";
import { ownerEmailFromRequest } from "@/lib/server-directory";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { role?: unknown; serverId?: unknown; channel?: unknown };
    const environment = await chatRealtimeEnv();
    if (!environment.CHAT_ROOMS) return Response.json({ error: "실시간 연결 서비스가 준비되지 않았습니다." }, { status: 503 });
    if (body.role === "admin") {
      const { session } = await requireAdmin(request, { mutating: true });
      const ticket = await issueChatRealtimeTicket(environment.DB, {
        scope: "global", role: "admin", principalEmail: session.email,
      });
      return Response.json({ ...ticket, scope: "global" }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    assertSameOrigin(request);
    if (body.role !== "owner" || typeof body.serverId !== "string" || !/^[a-f0-9]{32}$/.test(body.serverId)) {
      return Response.json({ error: "유효한 서버 실시간 연결 요청이 아닙니다." }, { status: 400 });
    }
    const ownerEmail = await ownerEmailFromRequest(request);
    const server = await environment.DB.prepare(`SELECT id, status, owner_verification_status FROM directory_servers
      WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`).bind(body.serverId, ownerEmail).first<{ id: string; status: string; owner_verification_status: string }>();
    if (!server) return Response.json({ error: "서버를 찾을 수 없거나 권한이 없습니다." }, { status: 404 });
    const operatorChannel = body.channel === "operators";
    if (operatorChannel && (server.status !== "active" || server.owner_verification_status !== "verified")) {
      return Response.json({ error: "소유권 인증이 완료된 운영 중 서버만 운영자 소통채널에 참여할 수 있습니다." }, { status: 403 });
    }
    const ticket = await issueChatRealtimeTicket(environment.DB, {
      scope: operatorChannel ? "operators" : "server", serverId: body.serverId, role: "owner", principalEmail: ownerEmail,
    });
    return Response.json({ ...ticket, scope: operatorChannel ? "operators" : "server" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw Response.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
}
