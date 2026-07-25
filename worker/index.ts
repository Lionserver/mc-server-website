/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { CHAT_CONNECTION_SECONDS, consumeChatRealtimeTicket, realtimeRoomName } from "../lib/chat-realtime";
import {
  activeFeatureBlock,
  expireFeatureControls,
  runTrackedAdminJob,
  type ActiveFeatureBlock,
  type AdminFeatureKey,
} from "../lib/admin-operations";
import { cleanupBroadcastImageCache } from "../lib/minecraft-stream-cache";
import { collectPublicStatusSnapshots, refreshPublicDirectoryInBackground } from "../lib/public-directory";
import { hasOwnerSessionCookie, resolveOwnerSessionEmail, trustedPlatformUserEmail } from "../lib/user-auth";
import { cleanupExpiredApplicationData } from "../lib/maintenance";
import { purgeExpiredServerQuarantines } from "../lib/server-quarantine";
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
    ctx.waitUntil(runScheduledOperations(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const controlledFeature = await publicWriteFeature(request, url);
    if (controlledFeature) {
      let blocked: ActiveFeatureBlock | null;
      try {
        blocked = await activeFeatureBlock(env.DB, controlledFeature);
      } catch (error) {
        console.error("public write operations guard failed", {
          featureKey: controlledFeature,
          name: error instanceof Error ? error.name : "unknown",
        });
        return secureResponse(operationsGuardUnavailableResponse(), false, true);
      }
      if (blocked) return secureResponse(featureDisabledResponse(blocked), false, true);
    }

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
        const authorized = await env.DB.prepare(`SELECT 1 authorized FROM directory_servers d
          LEFT JOIN user_accounts a ON a.email = d.owner_email
          WHERE d.id = ? AND d.owner_email = ? AND d.deleted_at IS NULL
            AND (a.id IS NULL OR a.account_status = 'active')
            AND (? <> 'operators' OR d.status = 'active' AND d.owner_verification_status = 'verified')
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
    return secureResponse(
      await handler.fetch(routedRequest, env, ctx),
      url.pathname.startsWith("/embed/server/"),
      url.pathname.startsWith("/api/"),
    );
  },
};

let lastDirectoryMaintenanceAt = 0;
let lastPrivacyCleanupAt = 0;

async function runScheduledOperations(env: Env) {
  await expireFeatureControls(env.DB).catch((error) => {
    console.error("feature control expiry failed", { name: error instanceof Error ? error.name : "unknown" });
  });
  const tasks = [
    {
      key: "public_status_snapshots",
      promise: runTrackedAdminJob(env.DB, "public_status_snapshots", "scheduled",
        () => collectPublicStatusSnapshots(env.DB)),
    },
    {
      key: "application_retention_cleanup",
      promise: runTrackedAdminJob(env.DB, "application_retention_cleanup", "scheduled",
        () => cleanupExpiredApplicationData(env.DB)),
    },
    {
      key: "server_quarantine_purge",
      promise: runTrackedAdminJob(env.DB, "server_quarantine_purge", "scheduled",
        () => purgeExpiredServerQuarantines(env)),
    },
    {
      key: "broadcast_cache_cleanup",
      promise: runTrackedAdminJob(env.DB, "broadcast_cache_cleanup", "scheduled", () => {
        if (!env.MEDIA) throw new Error("MEDIA binding is unavailable");
        return cleanupBroadcastImageCache(env.MEDIA);
      }),
    },
  ] as const;
  const results = await Promise.allSettled(tasks.map((task) => task.promise));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("scheduled operations job failed", {
        jobKey: tasks[index].key,
        name: result.reason instanceof Error ? result.reason.name : "unknown",
      });
    }
  });
}

async function publicWriteFeature(request: Request, url: URL): Promise<AdminFeatureKey | null> {
  if (!new Set(["POST", "PATCH", "PUT", "DELETE"]).has(request.method.toUpperCase())) return null;
  const pathname = url.pathname;
  if (!isApiPath(pathname) || killSwitchExemptPath(pathname)) return null;

  if (request.method === "POST" && pathname === "/api/realtime/ticket" && await requestsAdminRealtimeTicket(request)) {
    return null;
  }
  if (request.method === "POST" && pathname === "/api/servers") return "server_registration";
  if (/^\/api\/servers\/[^/]+\/assets$/.test(pathname)) return "media_uploads";
  if (/^\/api\/servers\/[^/]+\/description-assets(?:\/[^/]+)?$/.test(pathname)) return "media_uploads";
  if (/^\/api\/servers\/[^/]+\/bridge(?:\/verify)?$/.test(pathname)) return "bridge_provisioning";
  if (/^\/api\/servers\/[^/]+\/votes$/.test(pathname)) return "votes";
  if (/^\/api\/servers\/[^/]+$/.test(pathname)) return "server_management";
  if (pathAtOrBelow(pathname, "/api/ownership")) return "ownership";
  if (pathname === "/api/premium/auction") return "premium_bids";
  if (pathAtOrBelow(pathname, "/api/support") || pathname === "/api/operator/channel"
    || pathname === "/api/realtime/ticket") return "messaging";
  if (pathname === "/api/bridge/telemetry") return "bridge_telemetry";
  if (pathname === "/api/bridge/provision" || pathname === "/api/bridge/verify") return "bridge_provisioning";
  return "public_writes";
}

function killSwitchExemptPath(pathname: string) {
  return pathAtOrBelow(pathname, "/api/admin")
    || pathAtOrBelow(pathname, "/api/auth")
    || pathAtOrBelow(pathname, "/api/health")
    || pathAtOrBelow(pathname, "/api/traffic");
}

function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function pathAtOrBelow(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

async function requestsAdminRealtimeTicket(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4_096) return false;
  try {
    const body = await request.clone().json() as { role?: unknown };
    return body.role === "admin";
  } catch {
    return false;
  }
}

function featureDisabledResponse(block: ActiveFeatureBlock) {
  const now = Math.floor(Date.now() / 1000);
  const retryAfter = block.expiresAt == null ? 300 : Math.max(1, block.expiresAt - now);
  return Response.json({
    error: "현재 운영 점검으로 이 기능의 변경 작업이 일시 중지되었습니다.",
    code: "FEATURE_TEMPORARILY_DISABLED",
    featureKey: block.featureKey,
    retryAt: block.expiresAt,
  }, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfter),
    },
  });
}

function operationsGuardUnavailableResponse() {
  return Response.json({
    error: "운영 안전 상태를 확인하지 못해 변경 요청을 잠시 처리할 수 없습니다.",
    code: "OPERATIONS_GUARD_UNAVAILABLE",
    featureKey: null,
    retryAt: null,
  }, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": "60",
    },
  });
}

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

function secureResponse(response: Response, embeddable = false, noIndex = false) {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (noIndex) secured.headers.set("X-Robots-Tag", "noindex, nofollow");
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
