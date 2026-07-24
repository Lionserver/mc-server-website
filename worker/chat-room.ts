type ConnectionAttachment = {
  role: "admin" | "owner";
  principalEmail: string;
  serverId: string | null;
  connectedAt: number;
  expiresAt: number;
};

export class ChatRoom {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      if (request.headers.get("X-MKR-Realtime-Internal") !== "broadcast") return new Response("forbidden", { status: 403 });
      const event = await request.json() as { type?: unknown; serverId?: unknown };
      if (event.type !== "chat.message" || typeof event.serverId !== "string") return new Response("invalid event", { status: 400 });
      await this.closeExpiredConnections();
      const encoded = JSON.stringify(event);
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(encoded); } catch { socket.close(1011, "broadcast failed"); }
      }
      return Response.json({ delivered: this.ctx.getWebSockets().length });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket upgrade required", { status: 426 });
    if (request.headers.get("X-MKR-Realtime-Authorized") !== "ticket") return new Response("forbidden", { status: 403 });
    const role = request.headers.get("X-MKR-Realtime-Role");
    const principalEmail = request.headers.get("X-MKR-Realtime-Principal") ?? "";
    const serverId = request.headers.get("X-MKR-Realtime-Server");
    const expiresAt = Number(request.headers.get("X-MKR-Realtime-Expires-At"));
    if ((role !== "admin" && role !== "owner") || !principalEmail) return new Response("invalid identity", { status: 403 });
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 5 * 60_000 + 5_000) {
      return new Response("invalid connection expiry", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    const attachment: ConnectionAttachment = { role, principalEmail, serverId, connectedAt: Date.now(), expiresAt };
    server.serializeAttachment(attachment);
    await this.scheduleExpiry();
    server.send(JSON.stringify({ type: "chat.ready", connectedAt: attachment.connectedAt, expiresAt }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment || attachment.expiresAt <= Date.now()) {
      socket.close(4003, "authorization refresh required");
      return;
    }
    if (typeof message === "string" && message === "ping") socket.send(JSON.stringify({ type: "chat.pong", at: Date.now() }));
  }

  async webSocketError(socket: WebSocket) {
    try { socket.close(1011, "realtime transport error"); } catch { /* connection already closed */ }
  }

  async alarm() {
    await this.closeExpiredConnections();
    await this.scheduleExpiry();
  }

  private async closeExpiredConnections() {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (!attachment || attachment.expiresAt <= now) {
        try { socket.close(4003, "authorization refresh required"); } catch { /* already closed */ }
      }
    }
  }

  private async scheduleExpiry() {
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.expiresAt) nextExpiry = Math.min(nextExpiry, attachment.expiresAt);
    }
    if (Number.isFinite(nextExpiry)) await this.ctx.storage.setAlarm(nextExpiry);
    else await this.ctx.storage.deleteAlarm();
  }
}
