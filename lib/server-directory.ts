import { readDescriptionDocument } from "@/lib/server-description";
import { getOwnerSession } from "@/lib/user-auth";
import { parseServerCategories, readStoredServerCategories } from "@/lib/server-categories";

export interface DirectoryEnv {
  DB: D1Database;
  MEDIA?: R2Bucket;
  DIRECTORY_LIVE?: DurableObjectNamespace;
  VOTE_IP_HASH_SECRET?: string;
  SITE_TRAFFIC_HASH_SECRET?: string;
  BRIDGE_MASTER_SECRET?: string;
}

export type DirectoryServerInput = {
  title: string;
  shortDescription: string;
  description: string;
  edition: "JE" | "BE" | "JE + BE";
  minVersion: string;
  maxVersion: string;
  address: string;
  port: number;
  categories: string[];
};

export type ServerStaffInput = {
  role: string;
  nickname: string;
  minecraftUuid: string | null;
  introduction: string;
  discordEnabled: boolean;
  discordUrl: string;
};

export interface DirectoryServerRow {
  id: string;
  owner_email: string;
  title: string;
  short_description: string;
  description: string;
  description_document: string;
  edition: string;
  min_version: string;
  max_version: string;
  address: string;
  port: number;
  categories: string;
  status: string;
  bridge_server_id: string | null;
  owner_verification_status: string;
  owner_verified_at: number | null;
  discord_url: string;
  discord_enabled: number;
  website_url: string;
  website_enabled: number;
  kakao_url: string;
  kakao_enabled: number;
  staff_intro_enabled: number;
  resolved_ips: string;
  status_before_blacklist: string | null;
  status_before_enforcement: string | null;
  premium_managed?: number;
  premium_tier?: string;
  premium_starts_at?: number | null;
  premium_ends_at?: number | null;
  premium_note?: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const allowedEditions = new Set(["JE", "BE", "JE + BE"]);

export async function directoryEnv(): Promise<DirectoryEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as DirectoryEnv;
}

export async function ensureDirectorySchema(db: D1Database) {
  if (process.env.NODE_ENV === "production") return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS directory_servers (
    id TEXT PRIMARY KEY NOT NULL,
    owner_email TEXT NOT NULL,
    title TEXT NOT NULL,
    short_description TEXT NOT NULL,
    description TEXT NOT NULL,
    description_document TEXT NOT NULL DEFAULT '',
    edition TEXT NOT NULL,
    min_version TEXT NOT NULL,
    max_version TEXT NOT NULL,
    address TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 25565,
    categories TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    bridge_server_id TEXT,
    owner_verification_status TEXT NOT NULL DEFAULT 'unverified',
    owner_verified_at INTEGER,
    discord_url TEXT NOT NULL DEFAULT '',
    discord_enabled INTEGER NOT NULL DEFAULT 0,
    website_url TEXT NOT NULL DEFAULT '',
    website_enabled INTEGER NOT NULL DEFAULT 0,
    kakao_url TEXT NOT NULL DEFAULT '',
    kakao_enabled INTEGER NOT NULL DEFAULT 0,
    staff_intro_enabled INTEGER NOT NULL DEFAULT 0,
    resolved_ips TEXT NOT NULL DEFAULT '[]',
    status_before_blacklist TEXT,
    status_before_enforcement TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`).run();
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS directory_servers_owner_idx ON directory_servers (owner_email)"),
    db.prepare("CREATE INDEX IF NOT EXISTS directory_servers_status_idx ON directory_servers (status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS directory_servers_address_idx ON directory_servers (address COLLATE NOCASE, port) WHERE deleted_at IS NULL"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_assets (
      server_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      size INTEGER NOT NULL,
      focus_x INTEGER NOT NULL DEFAULT 50,
      focus_y INTEGER NOT NULL DEFAULT 50,
      zoom_percent INTEGER NOT NULL DEFAULT 100,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, kind)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS server_assets_server_idx ON server_assets (server_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_description_assets (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS server_description_assets_server_idx ON server_description_assets (server_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_staff_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      nickname TEXT NOT NULL,
      minecraft_uuid TEXT,
      introduction TEXT NOT NULL,
      discord_enabled INTEGER NOT NULL DEFAULT 0,
      discord_url TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS server_staff_order_idx ON server_staff_profiles (server_id, sort_order)"),
    db.prepare("CREATE INDEX IF NOT EXISTS server_staff_server_idx ON server_staff_profiles (server_id)"),
  ]);
  const assetColumns = await db.prepare("PRAGMA table_info(server_assets)").all<{ name: string }>();
  const assetColumnNames = new Set(assetColumns.results.map((column) => column.name));
  const assetAdditions: Array<[string, string]> = [
    ["focus_x", "ALTER TABLE server_assets ADD COLUMN focus_x INTEGER NOT NULL DEFAULT 50"],
    ["focus_y", "ALTER TABLE server_assets ADD COLUMN focus_y INTEGER NOT NULL DEFAULT 50"],
    ["zoom_percent", "ALTER TABLE server_assets ADD COLUMN zoom_percent INTEGER NOT NULL DEFAULT 100"],
  ];
  for (const [name, statement] of assetAdditions) if (!assetColumnNames.has(name)) await db.prepare(statement).run();
  const staffColumns = await db.prepare("PRAGMA table_info(server_staff_profiles)").all<{ name: string }>();
  if (!staffColumns.results.some((column) => column.name === "minecraft_uuid")) {
    await db.prepare("ALTER TABLE server_staff_profiles ADD COLUMN minecraft_uuid TEXT").run();
  }
}

export async function ownerEmailFromRequest(request: Request) {
  const url = new URL(request.url);
  const localPreview = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (localPreview && request.headers.get("x-mkr-local-owner") === "minecraft-kr-local-preview") {
    return "owner@minecraft.kr";
  }
  const platformSessionEmail = request.headers.get("x-mkr-authenticated-owner")?.trim().toLowerCase() ?? "";
  if (validEmail(platformSessionEmail)) return platformSessionEmail;
  const sessionEmail = (await getOwnerSession(request))?.email.trim().toLowerCase() ?? "";
  if (validEmail(sessionEmail)) return sessionEmail;
  throw Response.json({ error: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
}

export async function optionalOwnerEmail(request: Request) {
  try {
    return await ownerEmailFromRequest(request);
  } catch {
    return null;
  }
}

export function parseDirectoryInput(payload: unknown): DirectoryServerInput {
  if (!payload || typeof payload !== "object") throw Response.json({ error: "invalid payload" }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const title = cleanText(body.title, "title", 2, 60);
  const shortDescription = cleanText(body.shortDescription, "shortDescription", 2, 80);
  const description = cleanText(body.description, "description", 20, 10_000);
  const edition = typeof body.edition === "string" ? body.edition : "";
  if (!allowedEditions.has(edition)) throw Response.json({ error: "edition must be JE, BE, or JE + BE" }, { status: 400 });
  const minVersion = cleanText(body.minVersion, "minVersion", 1, 24);
  const maxVersion = cleanText(body.maxVersion, "maxVersion", 1, 24);
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const normalizedAddress = address.toLowerCase();
  if (!/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\.[a-z0-9-]+)*$/.test(normalizedAddress)) {
    throw Response.json({ error: "address must be a valid hostname" }, { status: 400 });
  }
  const port = Number(body.port ?? (edition === "BE" ? 19132 : 25565));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Response.json({ error: "port must be 1-65535" }, { status: 400 });
  let categories: string[];
  try { categories = parseServerCategories(body.categories); }
  catch (error) { throw Response.json({ error: error instanceof Error ? error.message : "카테고리를 확인해 주세요." }, { status: 400 }); }
  return { title, shortDescription, description, edition: edition as DirectoryServerInput["edition"], minVersion, maxVersion, address, port, categories };
}

export function serializeDirectoryServer(row: DirectoryServerRow, staff: Array<ServerStaffInput & { id?: string; sortOrder?: number }> = []) {
  let categories: string[] = [];
  try { categories = readStoredServerCategories(JSON.parse(row.categories)); } catch { categories = []; }
  const now = Math.floor(Date.now() / 1000);
  const premiumActive = row.premium_managed === 1 && row.premium_tier === "premium"
    && (row.premium_starts_at == null || row.premium_starts_at <= now)
    && (row.premium_ends_at == null || row.premium_ends_at > now);
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    descriptionDocument: readDescriptionDocument(row.description_document, row.description),
    edition: row.edition,
    minVersion: row.min_version,
    maxVersion: row.max_version,
    address: row.address,
    port: row.port,
    categories,
    status: row.status,
    bridgeServerId: row.bridge_server_id,
    ownerVerificationStatus: row.owner_verification_status ?? "unverified",
    ownerVerifiedAt: row.owner_verified_at ?? null,
    discordUrl: row.discord_url ?? "",
    discordEnabled: Boolean(row.discord_enabled),
    websiteUrl: row.website_url ?? "",
    websiteEnabled: Boolean(row.website_enabled),
    kakaoUrl: row.kakao_url ?? "",
    kakaoEnabled: Boolean(row.kakao_enabled),
    staffIntroEnabled: Boolean(row.staff_intro_enabled),
    staff,
    premiumManaged: Boolean(row.premium_managed),
    premiumTier: row.premium_tier === "premium" ? "premium" : "none",
    premiumStartsAt: row.premium_starts_at ?? null,
    premiumEndsAt: row.premium_ends_at ?? null,
    premiumNote: row.premium_note ?? "",
    premiumActive,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function staffProfilesByServer(db: D1Database, serverIds: string[]) {
  if (serverIds.length === 0) return new Map<string, Array<ServerStaffInput & { id: string; sortOrder: number }>>();
  const placeholders = serverIds.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT id, server_id, sort_order, role, nickname, minecraft_uuid, introduction, discord_enabled, discord_url
    FROM server_staff_profiles WHERE server_id IN (${placeholders}) ORDER BY server_id, sort_order`).bind(...serverIds)
    .all<{ id: string; server_id: string; sort_order: number; role: string; nickname: string; minecraft_uuid: string | null; introduction: string; discord_enabled: number; discord_url: string }>();
  const grouped = new Map<string, Array<ServerStaffInput & { id: string; sortOrder: number }>>();
  for (const row of rows.results) {
    const items = grouped.get(row.server_id) ?? [];
    items.push({ id: row.id, sortOrder: row.sort_order, role: row.role, nickname: row.nickname, minecraftUuid: row.minecraft_uuid, introduction: row.introduction,
      discordEnabled: Boolean(row.discord_enabled), discordUrl: row.discord_url ?? "" });
    grouped.set(row.server_id, items);
  }
  return grouped;
}

export function directoryErrorResponse(error: unknown) {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "unexpected error";
  if (/UNIQUE constraint failed: directory_servers\.address, directory_servers\.port/i.test(message)) {
    return Response.json({ error: "이미 등록된 서버 주소와 포트입니다." }, { status: 409 });
  }
  console.error("directory request failed", error);
  return Response.json({ error: process.env.NODE_ENV === "production" ? "요청을 처리하지 못했습니다." : message }, { status: 500 });
}

function cleanText(value: unknown, name: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw Response.json({ error: `${name} is required` }, { status: 400 });
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) {
    throw Response.json({ error: `${name} must be ${minimum}-${maximum} characters` }, { status: 400 });
  }
  return result;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
