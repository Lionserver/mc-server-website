/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { CHAT_CONNECTION_SECONDS, consumeChatRealtimeTicket, realtimeRoomName } from "../lib/chat-realtime";
import { cleanupBroadcastImageCache } from "../lib/minecraft-stream-cache";
import { collectPublicStatusSnapshots, refreshPublicDirectoryInBackground } from "../lib/public-directory";
import { hasOwnerSessionCookie, resolveOwnerSessionEmail, trustedPlatformUserEmail } from "../lib/user-auth";
import { cleanupExpiredApplicationData } from "../lib/maintenance";
export { ChatRoom } from "./chat-room";
export { DirectoryLive } from "./directory-live";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA?: R2Bucket;
  CHAT_ROOMS?: DurableObjectNamespace;
  DIRECTORY_LIVE?: DurableObjectNamespace;
  BRIDGE_ADMIN_TOKEN?: string;
  BRIDGE_MASTER_SECRET?: string;
  VOTE_IP_HASH_SECRET?: string;
  ALLOW_PRIVATE_BRIDGE_VERIFY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(collectPublicStatusSnapshots(env.DB));
    ctx.waitUntil(cleanupExpiredApplicationData(env.DB));
    if (env.MEDIA) ctx.waitUntil(cleanupBroadcastImageCache(env.MEDIA));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/servers" && shouldRunDirectoryMaintenance()) {
      ctx.waitUntil(refreshPublicDirectoryInBackground(env.DB).catch((error) => {
        console.error("directory background maintenance failed", error);
      }));
      if (shouldRunPrivacyCleanup()) {
        ctx.waitUntil(cleanupExpiredApplicationData(env.DB).catch((error) => {
          console.error("privacy retention cleanup failed", error);
        }));
      }
    }

    if (url.pathname === "/api/realtime/chat") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket upgrade required", { status: 426 });
      if (!env.CHAT_ROOMS) return new Response("realtime service unavailable", { status: 503 });
      const ticketToken = url.searchParams.get("ticket") ?? "";
      const ticket = await consumeChatRealtimeTicket(env.DB, ticketToken);
      if (!ticket) return new Response("invalid or expired realtime ticket", { status: 401 });
      const validOwnerScope = ticket.role === "owner" && Boolean(ticket.server_id) && (ticket.scope === "server" || ticket.scope === "operators");
      if ((ticket.role === "admin" && ticket.scope !== "global") || (ticket.role === "owner" && !validOwnerScope)) {
        return new Response("invalid realtime scope", { status: 403 });
      }
      if (ticket.role === "owner") {
        const authorized = await env.DB.prepare(`SELECT 1 authorized FROM directory_servers
          WHERE id = ? AND owner_email = ? AND deleted_at IS NULL
            AND (? <> 'operators' OR status = 'active' AND owner_verification_status = 'verified')
          LIMIT 1`).bind(ticket.server_id, ticket.principal_email, ticket.scope).first();
        if (!authorized) return new Response("realtime authorization changed", { status: 403 });
      }
      const roomName = realtimeRoomName(ticket);
      const room = env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(roomName));
      return room.fetch("https://chat.internal/connect", {
        headers: {
          Upgrade: "websocket",
          "X-MKR-Realtime-Authorized": "ticket",
          "X-MKR-Realtime-Role": ticket.role,
          "X-MKR-Realtime-Principal": ticket.principal_email,
          "X-MKR-Realtime-Server": ticket.server_id ?? "",
          "X-MKR-Realtime-Expires-At": String(Date.now() + CHAT_CONNECTION_SECONDS * 1_000),
        },
      });
    }

    if (url.pathname === "/api/realtime/directory") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket upgrade required", { status: 426 });
      if (!env.DIRECTORY_LIVE) return new Response("realtime service unavailable", { status: 503 });
      const room = env.DIRECTORY_LIVE.get(env.DIRECTORY_LIVE.idFromName("public-directory"));
      return room.fetch("https://directory.internal/connect", {
        headers: { Upgrade: "websocket", "X-MKR-Realtime-Authorized": "public-directory" },
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return secureResponse(response);
    }

    let routedRequest = request;
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
      const headers = new Headers(request.headers);
      headers.delete("X-MKR-Authenticated-Owner");
      headers.delete("OAI-Authenticated-User-Email");
      const hasOwnerIdentity = hasOwnerSessionCookie(request) || Boolean(trustedPlatformUserEmail(request));
      const ownerEmail = hasOwnerIdentity ? await resolveOwnerSessionEmail(env.DB, request).catch(() => null) : null;
      if (ownerEmail) headers.set("X-MKR-Authenticated-Owner", ownerEmail);
      routedRequest = new Request(request, { headers });
    }
    return secureResponse(await handler.fetch(routedRequest, env, ctx), url.pathname.startsWith("/embed/server/"));
  },
};

let lastDirectoryMaintenanceAt = 0;
let lastPrivacyCleanupAt = 0;

function shouldRunDirectoryMaintenance() {
  const now = Date.now();
  if (now - lastDirectoryMaintenanceAt < 30_000) return false;
  lastDirectoryMaintenanceAt = now;
  return true;
}

function shouldRunPrivacyCleanup() {
  const now = Date.now();
  if (now - lastPrivacyCleanupAt < 6 * 60 * 60 * 1_000) return false;
  lastPrivacyCleanupAt = now;
  return true;
}

function secureResponse(response: Response, embeddable = false) {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (embeddable) {
    secured.headers.delete("X-Frame-Options");
    secured.headers.set("Cross-Origin-Opener-Policy", "unsafe-none");
    secured.headers.set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors *; object-src 'none'; form-action 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'none'; connect-src 'none'");
  } else {
    secured.headers.set("X-Frame-Options", "DENY");
    secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    secured.headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mc-heads.net https://livecloud-thumb.akamaized.net https://nng-phinf.pstatic.net https://liveimg.sooplive.com https://profile.img.sooplive.com; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss:");
  }
  return secured;
}

export default worker;
