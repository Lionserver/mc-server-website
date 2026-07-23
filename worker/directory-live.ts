export class DirectoryLive {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      if (request.headers.get("X-MKR-Realtime-Internal") !== "broadcast") return new Response("forbidden", { status: 403 });
      const event = await request.json() as { type?: unknown; serverId?: unknown; updatedAt?: unknown };
      if (event.type !== "directory.updated" || typeof event.serverId !== "string" || typeof event.updatedAt !== "number") {
        return new Response("invalid event", { status: 400 });
      }
      const encoded = JSON.stringify(event);
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(encoded); } catch { socket.close(1011, "broadcast failed"); }
      }
      return Response.json({ delivered: this.ctx.getWebSockets().length });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket upgrade required", { status: 426 });
    if (request.headers.get("X-MKR-Realtime-Authorized") !== "public-directory") return new Response("forbidden", { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "directory.ready", connectedAt: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") socket.send(JSON.stringify({ type: "directory.pong", at: Date.now() }));
  }

  async webSocketError(socket: WebSocket) {
    try { socket.close(1011, "realtime transport error"); } catch { /* already closed */ }
  }
}
