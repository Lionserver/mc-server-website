import { directoryEnv } from "@/lib/server-directory";
import { isPbkdf2PasswordHash, isTotpSecret } from "@/lib/admin-credentials.mjs";

type ReadinessEnvironment = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  AUTH_CODE_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  SITES_AUTH_ENABLED?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_TOTP_SECRET?: string;
  BRIDGE_ADMIN_TOKEN?: string;
  BRIDGE_MASTER_SECRET?: string;
  VOTE_IP_HASH_SECRET?: string;
  CHAT_ROOMS?: DurableObjectNamespace;
  DIRECTORY_LIVE?: DurableObjectNamespace;
};

export async function GET() {
  const environment = await directoryEnv() as ReadinessEnvironment;
  let database = false;
  try {
    const probe = await environment.DB?.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    database = probe?.ok === 1;
  } catch {
    database = false;
  }

  const checks = {
    database,
    mediaStorage: Boolean(environment.MEDIA),
    sitesAuthentication: environment.SITES_AUTH_ENABLED === "true",
    ownerEmailAuthentication: hasMinimumLength(environment.AUTH_CODE_SECRET, 24)
      && hasMinimumLength(environment.RESEND_API_KEY, 12)
      && isEmailLike(environment.AUTH_EMAIL_FROM),
    permanentAdminAuth: isEmailLike(environment.ADMIN_EMAIL)
      && isPbkdf2PasswordHash(environment.ADMIN_PASSWORD_HASH)
      && isTotpSecret(environment.ADMIN_TOTP_SECRET),
    votePrivacySecret: hasMinimumLength(environment.VOTE_IP_HASH_SECRET, 32),
    bridge: hasMinimumLength(environment.BRIDGE_ADMIN_TOKEN, 24)
      && hasMinimumLength(environment.BRIDGE_MASTER_SECRET, 32),
    directoryRealtime: Boolean(environment.DIRECTORY_LIVE),
    chatRealtime: Boolean(environment.CHAT_ROOMS),
  };
  const ownerAuthentication = checks.sitesAuthentication || checks.ownerEmailAuthentication;
  const ready = checks.database
    && checks.mediaStorage
    && ownerAuthentication
    && checks.permanentAdminAuth
    && checks.votePrivacySecret
    && checks.bridge;

  return Response.json({
    service: "minecraft.kr",
    ok: ready,
    status: ready ? "ready" : "degraded",
    checks: { ...checks, ownerAuthentication },
    checkedAt: new Date().toISOString(),
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

function hasMinimumLength(value: string | undefined, minimum: number) {
  return typeof value === "string" && value.length >= minimum;
}

function isEmailLike(value: string | undefined) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
