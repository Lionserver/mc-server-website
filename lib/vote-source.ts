const IP_METADATA_RETENTION_SECONDS = 90 * 86_400;
const LOCAL_HASH_SECRET = "minecraft.kr-local-vote-ip-v1";

export type VoteSourceEnvironment = {
  VOTE_IP_HASH_SECRET?: string;
  BRIDGE_MASTER_SECRET?: string;
};

export type VoteSourceMetadata = {
  fingerprint: string;
  ipMasked: string;
  ipHash: string;
  ipVersion: 0 | 4 | 6;
};

export async function voteSourceMetadata(request: Request, serverId: string, environment: VoteSourceEnvironment): Promise<VoteSourceMetadata> {
  const ip = requestIpAddress(request);
  const agent = request.headers.get("user-agent")?.slice(0, 500) || "unknown";
  const secret = voteIpHashSecret(environment);
  const [fingerprint, ipHash] = await Promise.all([
    hmacHex(secret, `vote-source-fingerprint-v1|${serverId}|${ip}|${agent}`),
    hmacHex(secret, ip),
  ]);
  return { fingerprint, ipMasked: maskIpAddress(ip), ipHash, ipVersion: ipVersion(ip) };
}

export async function voteIpSearchHash(value: string, environment: VoteSourceEnvironment) {
  const ip = normalizeIpAddress(value);
  if (!ip) return null;
  return hmacHex(voteIpHashSecret(environment), ip);
}

export async function purgeExpiredVoteIpMetadata(db: D1Database, now = Math.floor(Date.now() / 1000)) {
  await db.prepare(`UPDATE server_votes SET source_fingerprint = 'expired:' || id,
      source_ip_masked = '', source_ip_hash = '', source_ip_version = 0
    WHERE created_at < ? AND (source_fingerprint NOT LIKE 'expired:%' OR source_ip_masked <> '' OR source_ip_hash <> '')`)
    .bind(now - IP_METADATA_RETENTION_SECONDS).run();
}

export async function synchronizeVoteSourceBlocks(db: D1Database, now = Math.floor(Date.now() / 1000)) {
  await db.prepare(`UPDATE vote_source_blocks SET status = 'expired', updated_at = ?
    WHERE status = 'active' AND expires_at <= ?`).bind(now, now).run();
}

export async function assertVoteSourceAllowed(db: D1Database, sourceIpHash: string, now = Math.floor(Date.now() / 1000)) {
  if (!sourceIpHash) return;
  await synchronizeVoteSourceBlocks(db, now);
  const block = await db.prepare(`SELECT id FROM vote_source_blocks
    WHERE source_ip_hash = ? AND status = 'active' AND expires_at > ? LIMIT 1`)
    .bind(sourceIpHash, now).first<{ id: string }>();
  if (block) {
    throw Response.json({ error: "해당 접속 환경은 추천 기능 이용이 일시 제한되었습니다." }, { status: 403 });
  }
}

export function requestIpAddress(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  return normalizeIpAddress(forwarded) ?? "local";
}

export function normalizeIpAddress(rawValue: string) {
  let value = rawValue.trim().toLowerCase();
  if (!value || value.length > 64) return null;
  if (value.startsWith("[") && value.includes("]")) value = value.slice(1, value.indexOf("]"));
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) value = ipv4WithPort[1];
  const ipv4 = value.split(".");
  if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return ipv4.map((part) => String(Number(part))).join(".");
  }
  if (value.includes(":") && /^[0-9a-f:]+$/.test(value) && !value.includes(":::")) return value;
  return null;
}

export function maskIpAddress(ip: string) {
  const version = ipVersion(ip);
  if (version === 4) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  }
  if (version === 6) {
    const prefix = ip.split(":").filter(Boolean).slice(0, 4).join(":");
    return `${prefix || "::"}::/64`;
  }
  return "LOCAL";
}

function ipVersion(ip: string): 0 | 4 | 6 {
  if (ip.split(".").length === 4) return 4;
  if (ip.includes(":")) return 6;
  return 0;
}

function voteIpHashSecret(environment: VoteSourceEnvironment) {
  return environment.VOTE_IP_HASH_SECRET?.trim() || environment.BRIDGE_MASTER_SECRET?.trim() || LOCAL_HASH_SECRET;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return hex(new Uint8Array(signature));
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
