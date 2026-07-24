import { networkFingerprintAddress, normalizeIpAddress } from "@/lib/ip-security.mjs";

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const RETENTION_SECONDS = 3 * 86_400;
const BOT_USER_AGENT =
  /\b(bot|crawler|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|postman)\b|python-requests|go-http-client|facebookexternalhit|oai-searchbot|gptbot|chatgpt-user/i;

const schemaPromises = new WeakMap<object, Promise<void>>();

export type TodayTraffic = {
  day: string;
  visitors: number;
  counted: boolean;
  generatedAt: number;
};

export async function ensureSiteTrafficSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  const key = db as unknown as object;
  let promise = schemaPromises.get(key);
  if (!promise) {
    promise = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS site_daily_visitors (
        visit_day TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        PRIMARY KEY (visit_day, visitor_hash)
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS site_daily_visitors_seen_idx ON site_daily_visitors (first_seen_at)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS site_daily_visitor_totals (
        visit_day TEXT PRIMARY KEY NOT NULL,
        visitor_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS site_daily_visitors_increment_total
        AFTER INSERT ON site_daily_visitors
        BEGIN
          INSERT INTO site_daily_visitor_totals (visit_day, visitor_count, updated_at)
          VALUES (NEW.visit_day, 1, NEW.first_seen_at)
          ON CONFLICT(visit_day) DO UPDATE SET
            visitor_count = visitor_count + 1,
            updated_at = MAX(updated_at, NEW.first_seen_at);
        END`),
      db.prepare(`INSERT INTO site_daily_visitor_totals (visit_day, visitor_count, updated_at)
        SELECT visit_day, COUNT(*), MAX(first_seen_at)
        FROM site_daily_visitors GROUP BY visit_day
        ON CONFLICT(visit_day) DO UPDATE SET
          visitor_count = excluded.visitor_count,
          updated_at = excluded.updated_at`),
    ]).then(() => undefined);
    schemaPromises.set(key, promise);
  }
  try {
    await promise;
  } catch (error) {
    schemaPromises.delete(key);
    throw error;
  }
}

export async function recordTodayVisitor(
  db: D1Database,
  request: Request,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
): Promise<TodayTraffic> {
  await ensureSiteTrafficSchema(db);
  const day = kstDay(now);
  if (!isCountableTrafficRequest(request)) {
    return { day, visitors: await visitorCount(db, day), counted: false, generatedAt: now };
  }
  if (secret.length < 32) {
    throw new Error("SITE_TRAFFIC_HASH_SECRET is not configured");
  }

  const fingerprint = await visitorFingerprint(request, secret, day);
  const inserted = await db.prepare(`INSERT OR IGNORE INTO site_daily_visitors
    (visit_day, visitor_hash, first_seen_at) VALUES (?, ?, ?)`)
    .bind(day, fingerprint, now)
    .run();
  return {
    day,
    visitors: await visitorCount(db, day),
    counted: Number(inserted.meta.changes ?? 0) > 0,
    generatedAt: now,
  };
}

export function isCountablePublicPath(pathname: string) {
  return pathname === "/"
    || pathname === "/broadcasts"
    || pathname === "/terms"
    || pathname === "/privacy"
    || pathname.startsWith("/servers/");
}

export function isCountableTrafficRequest(request: Request) {
  if (request.method !== "POST") return false;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (origin !== url.origin || !referer) return false;
  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch {
    return false;
  }
  if (refererUrl.origin !== url.origin || !isCountablePublicPath(refererUrl.pathname)) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const fetchDest = request.headers.get("sec-fetch-dest");
  if (fetchDest && fetchDest !== "empty") return false;
  const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;

  const userAgent = normalizedUserAgent(request.headers.get("user-agent") ?? "");
  return Boolean(userAgent) && !BOT_USER_AGENT.test(userAgent);
}

export function kstDay(now: number) {
  return new Date((now + KST_OFFSET_SECONDS) * 1_000).toISOString().slice(0, 10);
}

export function trafficRetentionBoundary(now: number) {
  return now - RETENTION_SECONDS;
}

async function visitorFingerprint(request: Request, secret: string, day: string) {
  const edgeAddress = request.headers.get("cf-connecting-ip");
  const localAddress = process.env.NODE_ENV === "production"
    ? null
    : request.headers.get("x-forwarded-for")?.split(",", 1)[0];
  const rawAddress = edgeAddress ?? localAddress ?? "";
  const normalizedAddress = normalizeIpAddress(rawAddress) ?? "unavailable";
  const network = networkFingerprintAddress(normalizedAddress);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${day}\n${network}`),
  ));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function visitorCount(db: D1Database, day: string) {
  const row = await db.prepare("SELECT visitor_count count FROM site_daily_visitor_totals WHERE visit_day = ?")
    .bind(day)
    .first<{ count: number }>();
  return Math.max(0, Number(row?.count ?? 0));
}

function normalizedUserAgent(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 384);
}
