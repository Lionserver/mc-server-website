import { adminErrorResponse, cleanMessage } from "@/lib/admin-security";
import { broadcastOperatorChatEvent, chatRealtimeEnv } from "@/lib/chat-realtime";
import { ensureOperatorChannelSchema, serializeOperatorMessage, type OperatorChannelRow } from "@/lib/operator-channel";
import { ownerEmailFromRequest } from "@/lib/server-directory";

type OperatorServer = {
  id: string;
  title: string;
  status: string;
  owner_verification_status: string;
};

export async function GET(request: Request) {
  try {
    const environment = await chatRealtimeEnv();
    const ownerEmail = await ownerEmailFromRequest(request);
    const serverId = new URL(request.url).searchParams.get("serverId") ?? "";
    await ensureOperatorChannelSchema(environment.DB);
    const server = await requireOperatorServer(environment.DB, serverId, ownerEmail);
    const rows = await environment.DB.prepare(`SELECT id, server_id, server_title, owner_email, body, created_at FROM (
      SELECT id, server_id, server_title, owner_email, body, created_at
      FROM operator_channel_messages ORDER BY created_at DESC LIMIT 300
    ) ORDER BY created_at ASC`).all<OperatorChannelRow>();
    return Response.json({
      server: { id: server.id, title: server.title },
      messages: rows.results.map(serializeOperatorMessage),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const environment = await chatRealtimeEnv();
    const ownerEmail = await ownerEmailFromRequest(request);
    const payload = await request.json() as { serverId?: unknown; body?: unknown };
    if (typeof payload.serverId !== "string") throw Response.json({ error: "대화에 사용할 서버를 선택해 주세요." }, { status: 400 });
    const body = cleanMessage(payload.body);
    await ensureOperatorChannelSchema(environment.DB);
    const server = await requireOperatorServer(environment.DB, payload.serverId, ownerEmail);
    const now = Math.floor(Date.now() / 1000);
    const recent = await environment.DB.prepare(`SELECT created_at FROM operator_channel_messages
      WHERE owner_email = ? ORDER BY created_at DESC LIMIT 1`).bind(ownerEmail).first<{ created_at: number }>();
    if (recent && now - recent.created_at < 2) {
      return Response.json({ error: "메시지는 2초에 한 번 전송할 수 있습니다." }, { status: 429 });
    }
    const id = crypto.randomUUID().replaceAll("-", "");
    await environment.DB.prepare(`INSERT INTO operator_channel_messages
      (id, server_id, server_title, owner_email, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, server.id, server.title, ownerEmail, body, now).run();
    const message = serializeOperatorMessage({
      id, server_id: server.id, server_title: server.title, owner_email: ownerEmail, body, created_at: now,
    });
    await broadcastOperatorChatEvent(environment, {
      type: "chat.message",
      serverId: server.id,
      message: { id, sender_role: "owner", sender_email: ownerEmail, server_title: server.title, body, created_at: now },
    }).catch(() => false);
    await environment.DB.prepare(`DELETE FROM operator_channel_messages WHERE id IN (
      SELECT id FROM operator_channel_messages ORDER BY created_at DESC LIMIT -1 OFFSET 2000
    )`).run().catch(() => undefined);
    return Response.json({ message }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

async function requireOperatorServer(db: D1Database, serverId: string, ownerEmail: string) {
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "유효한 서버를 선택해 주세요." }, { status: 400 });
  const server = await db.prepare(`SELECT id, title, status, owner_verification_status FROM directory_servers
    WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`).bind(serverId, ownerEmail).first<OperatorServer>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없거나 운영 권한이 없습니다." }, { status: 404 });
  if (server.status !== "active" || server.owner_verification_status !== "verified") {
    throw Response.json({ error: "소유권 인증이 완료된 운영 중 서버만 운영자 소통채널에 참여할 수 있습니다." }, { status: 403 });
  }
  return server;
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw Response.json({ error: "요청 출처를 확인할 수 없습니다." }, { status: 403 });
}
