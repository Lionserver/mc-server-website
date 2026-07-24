import { adminErrorResponse, cleanMessage, ensureAdminSchema } from "@/lib/admin-security";
import { directoryEnv, ownerEmailFromRequest } from "@/lib/server-directory";
import { broadcastChatEvent, type ChatRealtimeEnvironment } from "@/lib/chat-realtime";
import { assertSameOrigin } from "@/lib/user-auth";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

async function contextFor(request: Request, context: RouteContext) {
  const { serverId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "유효하지 않은 서버 ID입니다." }, { status: 400 });
  const ownerEmail = await ownerEmailFromRequest(request);
  const environment = await directoryEnv();
  await ensureAdminSchema(environment.DB);
  const server = await environment.DB.prepare(`SELECT id, title FROM directory_servers
    WHERE id = ? AND owner_email = ? AND deleted_at IS NULL`).bind(serverId, ownerEmail).first<{ id: string; title: string }>();
  if (!server) throw Response.json({ error: "서버를 찾을 수 없거나 권한이 없습니다." }, { status: 404 });
  return { environment, ownerEmail, server };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { environment, server } = await contextFor(request, context);
    const markRead = new URL(request.url).searchParams.get("markRead") !== "0";
    const messages = await environment.DB.prepare(`SELECT * FROM (SELECT id, sender_role, sender_email, body, created_at
      FROM admin_messages WHERE server_id = ? ORDER BY created_at DESC LIMIT 200) ORDER BY created_at ASC`).bind(server.id).all();
    const conversation = await environment.DB.prepare("SELECT unread_owner FROM admin_conversations WHERE server_id = ?")
      .bind(server.id).first<{ unread_owner: number }>();
    if (markRead && (conversation?.unread_owner ?? 0) > 0) {
      await environment.DB.prepare("UPDATE admin_conversations SET unread_owner = 0, updated_at = ? WHERE server_id = ?")
        .bind(Math.floor(Date.now() / 1000), server.id).run();
    }
    return Response.json({
      server,
      messages: messages.results.map((message) => ({
        ...message as Record<string, unknown>,
        sender_email: "",
      })),
      unreadOwner: markRead ? 0 : conversation?.unread_owner ?? 0,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const { environment, ownerEmail, server } = await contextFor(request, context);
    const body = cleanMessage((await request.json() as { body?: unknown }).body);
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID().replaceAll("-", "");
    await environment.DB.batch([
      environment.DB.prepare(`INSERT INTO admin_conversations
        (server_id, status, unread_admin, unread_owner, last_message_at, created_at, updated_at)
        VALUES (?, 'open', 1, 0, ?, ?, ?)
        ON CONFLICT(server_id) DO UPDATE SET status = 'open', unread_admin = unread_admin + 1,
        unread_owner = 0, last_message_at = excluded.last_message_at, updated_at = excluded.updated_at`)
        .bind(server.id, now, now, now),
      environment.DB.prepare(`INSERT INTO admin_messages (id, server_id, sender_role, sender_email, body, created_at)
        VALUES (?, ?, 'owner', ?, ?, ?)`).bind(id, server.id, ownerEmail, body, now),
    ]);
    const message = { id, sender_role: "owner" as const, sender_email: ownerEmail, body, created_at: now };
    const realtime = await broadcastChatEvent(environment as ChatRealtimeEnvironment, { type: "chat.message", serverId: server.id, message }).catch(() => false);
    return Response.json({ message, realtime }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
