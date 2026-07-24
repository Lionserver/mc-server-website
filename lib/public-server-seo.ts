import { directoryEnv } from "@/lib/server-directory";
import { readStoredServerCategories } from "@/lib/server-categories";

type SeoServerRow = {
  id: string;
  title: string;
  short_description: string;
  description: string;
  edition: string;
  min_version: string;
  max_version: string;
  address: string;
  port: number;
  categories: string;
  owner_verification_status: string;
  owner_verified_at: number | null;
  discord_url: string;
  discord_enabled: number;
  website_url: string;
  website_enabled: number;
  kakao_url: string;
  kakao_enabled: number;
  created_at: number;
  updated_at: number;
  bridge_verified_at: number | null;
  last_seen_at: number | null;
  total_players: number | null;
  max_players: number | null;
  last_ping_success_at: number | null;
  ping_players: number | null;
  ping_max_players: number | null;
  vote_count: number;
};

export type PublicServerSeoRecord = {
  id: string;
  name: string;
  summary: string;
  description: string;
  edition: "JE" | "BE" | "JE + BE";
  version: string;
  address: string;
  host: string;
  port: number;
  tags: string[];
  verified: boolean;
  online: boolean;
  players: number;
  capacity: number;
  votes: number;
  discordUrl: string | null;
  websiteUrl: string | null;
  kakaoUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

export async function indexablePublicServer(serverId: string) {
  if (!/^[a-f0-9]{32}$/.test(serverId)) return null;
  const environment = await directoryEnv();
  const row = await environment.DB.prepare(`SELECT
      d.id, d.title, d.short_description, d.description, d.edition, d.min_version, d.max_version,
      d.address, d.port, d.categories, d.owner_verification_status, d.owner_verified_at,
      d.discord_url, d.discord_enabled, d.website_url, d.website_enabled,
      d.kakao_url, d.kakao_enabled, d.created_at, d.updated_at,
      b.verified_at AS bridge_verified_at, b.last_seen_at, b.total_players, b.max_players,
      b.last_ping_success_at, b.ping_players, b.ping_max_players,
      (SELECT COUNT(*) FROM server_votes v WHERE v.server_id = d.id) AS vote_count
    FROM directory_servers d
    LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
    WHERE d.id = ? AND d.status = 'active' AND d.deleted_at IS NULL
    LIMIT 1`).bind(serverId).first<SeoServerRow>();

  return row ? serializeSeoServer(row) : null;
}

export async function indexablePublicServerUrls(limit = 50_000) {
  const environment = await directoryEnv();
  const safeLimit = Math.min(50_000, Math.max(1, Math.trunc(limit)));
  const rows = await environment.DB.prepare(`SELECT id, updated_at
    FROM directory_servers
    WHERE status = 'active' AND deleted_at IS NULL
    ORDER BY updated_at DESC, id ASC
    LIMIT ?`).bind(safeLimit).all<{ id: string; updated_at: number }>();
  return rows.results.map((row) => ({
    id: row.id,
    updatedAt: Number(row.updated_at),
  }));
}

function serializeSeoServer(row: SeoServerRow): PublicServerSeoRecord {
  const now = Math.floor(Date.now() / 1000);
  const bridgeOnline = Boolean(
    row.bridge_verified_at && row.last_seen_at && row.last_seen_at >= now - 120,
  );
  const pingOnline = Boolean(
    row.bridge_verified_at &&
      row.last_ping_success_at &&
      row.last_ping_success_at >= now - 120,
  );
  const defaultPort = row.edition === "BE" ? 19_132 : 25_565;

  return {
    id: row.id,
    name: row.title,
    summary: row.short_description,
    description: row.description,
    edition: normalizeEdition(row.edition),
    version:
      row.min_version === row.max_version
        ? row.min_version
        : `${row.min_version} — ${row.max_version}`,
    address:
      row.port === defaultPort ? row.address : `${row.address}:${row.port}`,
    host: row.address,
    port: Number(row.port),
    tags: parseTags(row.categories),
    verified:
      row.owner_verification_status === "verified" &&
      Boolean(row.owner_verified_at),
    online: bridgeOnline || pingOnline,
    players: bridgeOnline
      ? Math.max(0, Number(row.total_players ?? 0))
      : pingOnline
        ? Math.max(0, Number(row.ping_players ?? 0))
        : 0,
    capacity: bridgeOnline
      ? Math.max(0, Number(row.max_players ?? 0))
      : pingOnline
        ? Math.max(0, Number(row.ping_max_players ?? 0))
        : 0,
    votes: Math.max(0, Number(row.vote_count ?? 0)),
    discordUrl: row.discord_enabled ? safePublicUrl(row.discord_url) : null,
    websiteUrl: row.website_enabled ? safePublicUrl(row.website_url) : null,
    kakaoUrl: row.kakao_enabled ? safePublicUrl(row.kakao_url) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function normalizeEdition(value: string): PublicServerSeoRecord["edition"] {
  if (value === "BE" || value === "JE + BE") return value;
  return "JE";
}

function parseTags(value: string) {
  try {
    return readStoredServerCategories(JSON.parse(value));
  } catch {
    return [];
  }
}

function safePublicUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
