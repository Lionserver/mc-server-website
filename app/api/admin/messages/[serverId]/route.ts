import { adminErrorResponse, cleanMessage, prepareAuditWrite, requireAdmin } from "@/lib/admin-security";
import { broadcastChatEvent, type ChatRealtimeEnvironment } from "@/lib/chat-realtime";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

async function serverIdFrom(context: RouteContext) {
  const { serverId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "유효하지 않은 서버 ID입니다." }, { status: 400 });
  return serverId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const serverId = await serverIdFrom(context);
    const { environment } = await requireAdmin(request);
    const server = await environment.DB.prepare("SELECT title, owner_email FROM directory_servers WHERE id = ?")
      .bind(serverId).first<{ title: string; owner_email: string }>();
    if (!server) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
    const messages = await environment.DB.prepare(`SELECT * FROM (SELECT id, sender_role, sender_email, body, created_at
      FROM admin_messages WHERE server_id = ? ORDER BY created_at DESC LIMIT 200) ORDER BY created_at ASC`).bind(serverId).all();
    await environment.DB.prepare("UPDATE admin_conversations SET unread_admin = 0, updated_at = ? WHERE server_id = ?")
      .bind(Math.floor(Date.now() / 1000), serverId).run();
    return Response.json({ server: { id: serverId, title: server.title, ownerEmail: server.owner_email }, messages: messages.results }, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const serverId = await serverIdFrom(context);
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const server = await environment.DB.prepare("SELECT title FROM directory_servers WHERE id = ?")
      .bind(serverId).first<{ title: string }>();
    if (!server) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
    const body = cleanMessage((await request.json() as { body?: unknown }).body);
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID().replaceAll("-", "");
    await environment.DB.batch([
      environment.DB.prepare(`INSERT INTO admin_conversations
        (server_id, status, unread_admin, unread_owner, last_message_at, created_at, updated_at)
        VALUES (?, 'open', 0, 1, ?, ?, ?)
        ON CONFLICT(server_id) DO UPDATE SET status = 'open', unread_owner = unread_owner + 1,
        unread_admin = 0, last_message_at = excluded.last_message_at, updated_at = excluded.updated_at`)
        .bind(serverId, now, now, now),
      environment.DB.prepare(`INSERT INTO admin_messages (id, server_id, sender_role, sender_email, body, created_at)
        VALUES (?, ?, 'admin', ?, ?, ?)`).bind(id, serverId, session.email, body, now),
      prepareAuditWrite(environment.DB, session.email, "conversation.message.sent", "server", serverId, {
        messageId: id,
        length: body.length,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    const message = { id, sender_role: "admin" as const, sender_email: session.email, body, created_at: now };
    const realtime = await broadcastChatEvent(environment as ChatRealtimeEnvironment, {
      type: "chat.message",
      serverId,
      message: { ...message, sender_email: "" },
    }).catch(() => false);
    return Response.json({ message, realtime }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
