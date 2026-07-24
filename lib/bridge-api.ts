export interface BridgeEnv {
  DB: D1Database;
  BRIDGE_ADMIN_TOKEN?: string;
  BRIDGE_MASTER_SECRET?: string;
  ALLOW_PRIVATE_BRIDGE_VERIFY?: string;
  DIRECTORY_LIVE?: DurableObjectNamespace;
}

export interface BridgeServerRow {
  server_id: string;
  platform: string;
  public_host: string;
  public_port: number;
  challenge_hash: string;
  challenge_expires_at: number;
  verified_at: number | null;
  last_seen_at: number | null;
  last_ping_attempt_at: number | null;
  last_ping_success_at: number | null;
  ping_players: number;
  ping_max_players: number;
  ping_latency_ms: number;
  ping_version: string;
  total_players: number;
  max_players: number;
  backend_count: number;
  average_ping_ms: number;
  software: string;
  version: string;
  plugin_version: string;
  created_at: number;
  updated_at: number;
}

export async function bridgeEnv(): Promise<BridgeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as BridgeEnv;
}

export async function ensureBridgeSchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS bridge_servers (
      server_id TEXT PRIMARY KEY NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      public_host TEXT NOT NULL,
      public_port INTEGER NOT NULL,
      challenge_hash TEXT NOT NULL,
      challenge_expires_at INTEGER NOT NULL,
      verified_at INTEGER,
      last_seen_at INTEGER,
      last_ping_attempt_at INTEGER,
      last_ping_success_at INTEGER,
      ping_players INTEGER NOT NULL DEFAULT 0,
      ping_max_players INTEGER NOT NULL DEFAULT 0,
      ping_latency_ms INTEGER NOT NULL DEFAULT 0,
      ping_version TEXT NOT NULL DEFAULT 'unknown',
      total_players INTEGER NOT NULL DEFAULT 0,
      max_players INTEGER NOT NULL DEFAULT 0,
      backend_count INTEGER NOT NULL DEFAULT 0,
      average_ping_ms INTEGER NOT NULL DEFAULT 0,
      software TEXT NOT NULL DEFAULT 'unknown',
      version TEXT NOT NULL DEFAULT 'unknown',
      plugin_version TEXT NOT NULL DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS bridge_nonces (
      server_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, nonce)
    )`,
    `CREATE TABLE IF NOT EXISTS bridge_backends (
      server_id TEXT NOT NULL,
      backend_id TEXT NOT NULL,
      players INTEGER NOT NULL,
      max_players INTEGER NOT NULL,
      online INTEGER NOT NULL,
      software TEXT NOT NULL,
      version TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, backend_id)
    )`,
    "CREATE INDEX IF NOT EXISTS bridge_nonces_expiry_idx ON bridge_nonces (expires_at)",
    "CREATE INDEX IF NOT EXISTS bridge_backends_server_idx ON bridge_backends (server_id)",
  ];
  for (const sql of statements) await db.prepare(sql).run();

  const columns = await db.prepare("PRAGMA table_info(bridge_servers)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["last_ping_attempt_at", "ALTER TABLE bridge_servers ADD COLUMN last_ping_attempt_at INTEGER"],
    ["last_ping_success_at", "ALTER TABLE bridge_servers ADD COLUMN last_ping_success_at INTEGER"],
    ["ping_players", "ALTER TABLE bridge_servers ADD COLUMN ping_players INTEGER NOT NULL DEFAULT 0"],
    ["ping_max_players", "ALTER TABLE bridge_servers ADD COLUMN ping_max_players INTEGER NOT NULL DEFAULT 0"],
    ["ping_latency_ms", "ALTER TABLE bridge_servers ADD COLUMN ping_latency_ms INTEGER NOT NULL DEFAULT 0"],
    ["ping_version", "ALTER TABLE bridge_servers ADD COLUMN ping_version TEXT NOT NULL DEFAULT 'unknown'"],
  ];
  for (const [name, sql] of additions) if (!names.has(name)) await db.prepare(sql).run();
}

export async function deriveBridgeSecret(serverId: string) {
  const masterSecret = (await bridgeEnv()).BRIDGE_MASTER_SECRET;
  if (!masterSecret || masterSecret.length < 24) throw new Error("BRIDGE_MASTER_SECRET is not configured securely");
  return hmacHex(masterSecret, `bridge:${serverId}`);
}

export async function hashHex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(hash);
}

export async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function authenticateBridgeRequest(request: Request, body: string) {
  const serverId = request.headers.get("X-MKR-Server-Id")?.trim() ?? "";
  const timestampText = request.headers.get("X-MKR-Timestamp")?.trim() ?? "";
  const nonce = request.headers.get("X-MKR-Nonce")?.trim() ?? "";
  const suppliedSignature = request.headers.get("X-MKR-Signature")?.trim().toLowerCase() ?? "";
  const timestamp = Number(timestampText);
  const now = Math.floor(Date.now() / 1000);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(serverId)) throw new Response("invalid server id", { status: 401 });
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > 300) throw new Response("expired request", { status: 401 });
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(nonce)) throw new Response("invalid nonce", { status: 401 });
  if (!/^[a-f0-9]{64}$/.test(suppliedSignature)) throw new Response("invalid signature", { status: 401 });

  const url = new URL(request.url);
  const canonical = `${timestampText}\n${nonce}\n${request.method.toUpperCase()}\n${url.pathname}\n${await hashHex(body)}`;
  const expectedSignature = await hmacHex(await deriveBridgeSecret(serverId), canonical);
  if (!timingSafeEqual(expectedSignature, suppliedSignature)) throw new Response("invalid signature", { status: 401 });

  const db = (await bridgeEnv()).DB;
  await ensureBridgeSchema(db);
  await db.prepare("DELETE FROM bridge_nonces WHERE expires_at < ?").bind(now).run();
  try {
    await db.prepare("INSERT INTO bridge_nonces (server_id, nonce, expires_at) VALUES (?, ?, ?)")
      .bind(serverId, nonce, now + 600).run();
  } catch {
    throw new Response("replayed request", { status: 409 });
  }
  const server = await db.prepare("SELECT * FROM bridge_servers WHERE server_id = ?")
    .bind(serverId).first<BridgeServerRow>();
  if (!server) throw new Response("unknown server", { status: 404 });
  return server;
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "unexpected error";
  console.error("bridge request failed", error);
  return Response.json({
    error: process.env.NODE_ENV === "production" ? "브리지 요청을 처리하지 못했습니다." : message,
  }, { status: 500 });
}

export function boundedInteger(value: unknown, name: string, maximum = 10_000_000) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Response(`${name} must be an integer from 0 to ${maximum}`, { status: 400 });
  }
  return Number(value);
}

export function boundedText(value: unknown, name: string, maximum = 160) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Response(`${name} must be 1-${maximum} characters`, { status: 400 });
  }
  return value;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
