import { assertAddressNotBlacklisted, ensureAdminSchema, synchronizeBlacklist, synchronizeServerEnforcements } from "@/lib/admin-security";
import { ensureBridgeSchema } from "@/lib/bridge-api";
import { pingMinecraftServer } from "@/lib/minecraft-ping";
import { ensureMinecraftProfileSchema } from "@/lib/minecraft-profile";
import { synchronizePremiumAuctions } from "@/lib/premium-auction";
import { directoryEnv, type DirectoryServerRow } from "@/lib/server-directory";
import { readDescriptionDocument, type DescriptionDocument } from "@/lib/server-description";
import { readStoredServerCategories } from "@/lib/server-categories";

export type PublicStaffProfile = {
  id: string;
  role: string;
  nickname: string;
  minecraftUuid: string | null;
  introduction: string;
  discordEnabled: boolean;
  discordUrl: string;
  sortOrder: number;
};

export type PublicVote = {
  id: string;
  nickname: string;
  minecraftUuid: string | null;
  rewardStatus: string;
  createdAt: number;
};

export type PublicTrendPoint = { bucketAt: number; day: string; players: number; maxPlayers: number; samples: number; source: "bridge" | "ping" | "mixed" };
export type PublicBannerContentTypes = {
  desktopList: string | null;
  mobileList: string | null;
  desktopDetail: string | null;
  mobileDetail: string | null;
};
export type PublicBannerTransform = { focusX: number; focusY: number; zoom: number };
export type PublicTrustFactor = {
  key: "ownership" | "bridge" | "uptime" | "recentStatus" | "policy" | "history";
  label: string;
  score: number;
  maxScore: number;
  state: "earned" | "partial" | "missing" | "penalty";
  detail: string;
};

export type PublicServer = {
  id: string;
  name: string;
  address: string;
  host: string;
  port: number;
  edition: "JE" | "BE" | "JE + BE";
  version: string;
  summary: string;
  description: string;
  descriptionDocument: DescriptionDocument;
  players: number;
  capacity: number;
  latency: number;
  uptime: number;
  trust: number;
  trustGrade: "S" | "A" | "B" | "C" | "D";
  trustLabel: string;
  trustBreakdown: PublicTrustFactor[];
  enforcementSummary: { warnings: number; serious: number; active: number };
  votes: number;
  growth: number;
  averagePlayers7d: number | null;
  tags: string[];
  verified: boolean;
  online: boolean;
  statusSource: "bridge" | "ping" | "none";
  bridgeStatus: "live" | "stale" | "not_connected";
  sponsored: boolean;
  hasIcon: boolean;
  iconContentType: string | null;
  iconTransform: PublicBannerTransform;
  hasListBanner: boolean;
  hasDetailBanner: boolean;
  bannerContentTypes: PublicBannerContentTypes;
  bannerTransforms: Record<keyof PublicBannerContentTypes, PublicBannerTransform>;
  discordUrl: string;
  discordEnabled: boolean;
  websiteUrl: string;
  websiteEnabled: boolean;
  kakaoUrl: string;
  kakaoEnabled: boolean;
  staffIntroEnabled: boolean;
  staff: PublicStaffProfile[];
  recentVotes: PublicVote[];
  monthlyTop: Array<{ nickname: string; minecraftUuid: string | null; count: number }>;
  trend: PublicTrendPoint[];
  trendSource: "bridge" | "ping" | "mixed" | "none";
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type PublicRow = DirectoryServerRow & {
  discord_url: string;
  website_url: string;
  staff_intro_enabled: number;
  votes_override: number | null;
  votes_adjustment: number;
  uptime_basis_points: number | null;
  uptime_adjustment_basis_points: number;
  premium_managed: number;
  premium_tier: string;
  premium_starts_at: number | null;
  premium_ends_at: number | null;
  bridge_verified_at: number | null;
  last_seen_at: number | null;
  last_ping_attempt_at: number | null;
  last_ping_success_at: number | null;
  ping_players: number | null;
  ping_max_players: number | null;
  ping_latency_ms: number | null;
  ping_version: string | null;
  total_players: number | null;
  max_players: number | null;
  average_ping_ms: number | null;
  vote_count: number;
  history_uptime: number | null;
  history_days: number;
  warning_count: number;
  serious_enforcement_count: number;
  active_enforcement_count: number;
  recent_average: number | null;
  previous_average: number | null;
  has_icon: number;
  icon_content_type: string | null;
  icon_focus_x: number | null;
  icon_focus_y: number | null;
  icon_zoom: number | null;
  has_list_banner: number;
  has_detail_banner: number;
  desktop_list_content_type: string | null;
  mobile_list_content_type: string | null;
  desktop_detail_content_type: string | null;
  mobile_detail_content_type: string | null;
  desktop_list_focus_x: number | null;
  desktop_list_focus_y: number | null;
  desktop_list_zoom: number | null;
  mobile_list_focus_x: number | null;
  mobile_list_focus_y: number | null;
  mobile_list_zoom: number | null;
  desktop_detail_focus_x: number | null;
  desktop_detail_focus_y: number | null;
  desktop_detail_zoom: number | null;
  mobile_detail_focus_x: number | null;
  mobile_detail_focus_y: number | null;
  mobile_detail_zoom: number | null;
  premium_bid_amount: number | null;
  sponsored: number;
};

let schemaPromise: Promise<void> | null = null;

export function ensurePublicDirectorySchema(db: D1Database) {
  // Production schema is applied from the checked-in Drizzle migrations before
  // the worker is promoted. Runtime DDL on a cold isolate adds many remote D1
  // round-trips and can race with normal requests. Keep the compatibility
  // initializer only for local smoke tests that intentionally start empty.
  if (process.env.NODE_ENV === "production") return Promise.resolve();
  schemaPromise ??= initializePublicDirectorySchema(db).catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function initializePublicDirectorySchema(db: D1Database) {
  await ensureAdminSchema(db);
  await ensureBridgeSchema(db);
  await ensureMinecraftProfileSchema(db);
  const columns = await db.prepare("PRAGMA table_info(directory_servers)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["discord_url", "ALTER TABLE directory_servers ADD COLUMN discord_url TEXT NOT NULL DEFAULT ''"],
    ["description_document", "ALTER TABLE directory_servers ADD COLUMN description_document TEXT NOT NULL DEFAULT ''"],
    ["discord_enabled", "ALTER TABLE directory_servers ADD COLUMN discord_enabled INTEGER NOT NULL DEFAULT 0"],
    ["website_url", "ALTER TABLE directory_servers ADD COLUMN website_url TEXT NOT NULL DEFAULT ''"],
    ["website_enabled", "ALTER TABLE directory_servers ADD COLUMN website_enabled INTEGER NOT NULL DEFAULT 0"],
    ["kakao_url", "ALTER TABLE directory_servers ADD COLUMN kakao_url TEXT NOT NULL DEFAULT ''"],
    ["kakao_enabled", "ALTER TABLE directory_servers ADD COLUMN kakao_enabled INTEGER NOT NULL DEFAULT 0"],
    ["staff_intro_enabled", "ALTER TABLE directory_servers ADD COLUMN staff_intro_enabled INTEGER NOT NULL DEFAULT 0"],
    ["resolved_ips", "ALTER TABLE directory_servers ADD COLUMN resolved_ips TEXT NOT NULL DEFAULT '[]'"],
    ["status_before_blacklist", "ALTER TABLE directory_servers ADD COLUMN status_before_blacklist TEXT"],
    ["status_before_enforcement", "ALTER TABLE directory_servers ADD COLUMN status_before_enforcement TEXT"],
  ];
  for (const [name, statement] of additions) if (!names.has(name)) await db.prepare(statement).run();

  const indexes = await db.prepare("PRAGMA index_list(directory_servers)").all<{ name: string; unique: number }>();
  const addressIndex = indexes.results.find((index) => index.name === "directory_servers_address_idx");
  const addressIndexDefinition = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'directory_servers_address_idx'").first<{ sql: string | null }>();
  if (!addressIndex?.unique || !addressIndexDefinition?.sql?.toUpperCase().includes("COLLATE NOCASE")) {
    await db.prepare("DROP INDEX IF EXISTS directory_servers_address_idx").run();
    await db.prepare("CREATE UNIQUE INDEX directory_servers_address_idx ON directory_servers (address COLLATE NOCASE, port) WHERE deleted_at IS NULL").run();
  }

  await db.batch([
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
    db.prepare(`CREATE TABLE IF NOT EXISTS server_votes (
      id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      minecraft_uuid TEXT,
      vote_day TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      source_ip_masked TEXT NOT NULL DEFAULT '',
      source_ip_hash TEXT NOT NULL DEFAULT '',
      source_ip_version INTEGER NOT NULL DEFAULT 0,
      reward_status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS server_votes_daily_idx ON server_votes (server_id, nickname, vote_day)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS server_votes_daily_nocase_idx ON server_votes (server_id, lower(nickname), vote_day)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS server_votes_source_daily_idx ON server_votes (server_id, source_fingerprint, vote_day)"),
    db.prepare("CREATE INDEX IF NOT EXISTS server_votes_recent_idx ON server_votes (server_id, created_at DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS bridge_telemetry_history (
      server_id TEXT NOT NULL,
      bucket_at INTEGER NOT NULL,
      total_players INTEGER NOT NULL,
      max_players INTEGER NOT NULL,
      average_ping_ms INTEGER NOT NULL,
      online INTEGER NOT NULL,
      PRIMARY KEY (server_id, bucket_at)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS bridge_history_server_time_idx ON bridge_telemetry_history (server_id, bucket_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS server_status_history (
      server_id TEXT NOT NULL,
      bucket_at INTEGER NOT NULL,
      players INTEGER NOT NULL,
      max_players INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      online INTEGER NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (server_id, bucket_at)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS server_status_history_time_idx ON server_status_history (server_id, bucket_at)"),
  ]);

  const staffColumns = await db.prepare("PRAGMA table_info(server_staff_profiles)").all<{ name: string }>();
  const staffNames = new Set(staffColumns.results.map((column) => column.name));
  if (!staffNames.has("minecraft_uuid")) await db.prepare("ALTER TABLE server_staff_profiles ADD COLUMN minecraft_uuid TEXT").run();
  if (!staffNames.has("discord_enabled")) await db.prepare("ALTER TABLE server_staff_profiles ADD COLUMN discord_enabled INTEGER NOT NULL DEFAULT 0").run();
  if (!staffNames.has("discord_url")) await db.prepare("ALTER TABLE server_staff_profiles ADD COLUMN discord_url TEXT NOT NULL DEFAULT ''").run();
  const voteColumns = await db.prepare("PRAGMA table_info(server_votes)").all<{ name: string }>();
  const voteNames = new Set(voteColumns.results.map((column) => column.name));
  if (!voteNames.has("minecraft_uuid")) await db.prepare("ALTER TABLE server_votes ADD COLUMN minecraft_uuid TEXT").run();
  if (!voteNames.has("source_ip_masked")) await db.prepare("ALTER TABLE server_votes ADD COLUMN source_ip_masked TEXT NOT NULL DEFAULT ''").run();
  if (!voteNames.has("source_ip_hash")) await db.prepare("ALTER TABLE server_votes ADD COLUMN source_ip_hash TEXT NOT NULL DEFAULT ''").run();
  if (!voteNames.has("source_ip_version")) await db.prepare("ALTER TABLE server_votes ADD COLUMN source_ip_version INTEGER NOT NULL DEFAULT 0").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS server_votes_uuid_daily_idx ON server_votes (server_id, minecraft_uuid, vote_day) WHERE minecraft_uuid IS NOT NULL").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS server_votes_source_ip_idx ON server_votes (source_ip_hash, created_at)").run();
  await db.prepare(`INSERT OR IGNORE INTO server_status_history
    (server_id, bucket_at, players, max_players, latency_ms, online, source)
    SELECT d.id, h.bucket_at, h.total_players, h.max_players, h.average_ping_ms, h.online, 'bridge'
    FROM bridge_telemetry_history h JOIN directory_servers d ON d.bridge_server_id = h.server_id`).run();
}

export async function publicServerList(request: Request) {
  const environment = await directoryEnv();
  await ensurePublicDirectorySchema(environment.DB);
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const offset = (page - 1) * limit;
  const now = unixNow();
  const rows = await environment.DB.prepare(`${publicSelectSql()}
    WHERE d.status = 'active' AND d.deleted_at IS NULL
    ORDER BY sponsored DESC, COALESCE(premium_bid_amount, 0) DESC,
      votes_override IS NULL, MAX(0, COALESCE(votes_override, vote_count + COALESCE(votes_adjustment, 0))) DESC, d.updated_at DESC
    LIMIT ? OFFSET ?`)
    .bind(now, now - 30 * 86_400, now - 7 * 86_400, now - 14 * 86_400, now - 7 * 86_400,
      now - 14 * 86_400, now, now, limit, offset)
    .all<PublicRow>();
  const count = await environment.DB.prepare("SELECT COUNT(*) count FROM directory_servers WHERE status = 'active' AND deleted_at IS NULL")
    .first<{ count: number }>();
  return {
    servers: rows.results.map((row) => serializePublicRow(row, now, false)),
    page,
    pageSize: limit,
    total: Number(count?.count ?? 0),
    generatedAt: now,
  };
}

export async function publicServerDetail(db: D1Database, serverId: string) {
  await ensurePublicDirectorySchema(db);
  const now = unixNow();
  const row = await db.prepare(`${publicSelectSql()} WHERE d.id = ? AND d.status = 'active' AND d.deleted_at IS NULL LIMIT 1`)
    .bind(now, now - 30 * 86_400, now - 7 * 86_400, now - 14 * 86_400, now - 7 * 86_400,
      now - 14 * 86_400, now, now, serverId)
    .first<PublicRow>();
  if (!row) return null;
  const month = kstDay(now).slice(0, 7);
  const [staff, votes, monthly, trend] = await Promise.all([
    db.prepare(`SELECT id, role, nickname, minecraft_uuid, introduction, discord_enabled, discord_url, sort_order FROM server_staff_profiles
      WHERE server_id = ? ORDER BY sort_order ASC LIMIT 12`).bind(serverId).all<{ id: string; role: string; nickname: string; minecraft_uuid: string | null; introduction: string; discord_enabled: number; discord_url: string; sort_order: number }>(),
    db.prepare(`SELECT id, nickname, minecraft_uuid, reward_status, created_at FROM server_votes
      WHERE server_id = ? ORDER BY created_at DESC LIMIT 20`).bind(serverId).all<{ id: string; nickname: string; minecraft_uuid: string | null; reward_status: string; created_at: number }>(),
    db.prepare(`SELECT nickname, minecraft_uuid, COUNT(*) count FROM server_votes WHERE server_id = ? AND vote_day LIKE ?
      GROUP BY COALESCE(minecraft_uuid, lower(nickname)) ORDER BY count DESC, MAX(created_at) ASC LIMIT 5`).bind(serverId, `${month}%`).all<{ nickname: string; minecraft_uuid: string | null; count: number }>(),
    db.prepare(`SELECT bucket_at, players, max_players, source
      FROM server_status_history WHERE server_id = ? AND bucket_at >= ?
      ORDER BY bucket_at ASC`).bind(serverId, now - 14 * 86_400).all<{ bucket_at: number; players: number; max_players: number; source: "bridge" | "ping" }>(),
  ]);
  const trendSources = new Set(trend.results.map((point) => point.source));
  const trendSource: PublicServer["trendSource"] = trendSources.size > 1 ? "mixed" : trendSources.has("bridge") ? "bridge" : trendSources.has("ping") ? "ping" : "none";
  return {
    ...serializePublicRow(row, now),
    staff: row.staff_intro_enabled ? staff.results.map((item) => ({
      id: item.id,
      role: item.role,
      nickname: item.nickname,
      minecraftUuid: item.minecraft_uuid,
      introduction: item.introduction,
      discordEnabled: Boolean(item.discord_enabled),
      discordUrl: item.discord_url ?? "",
      sortOrder: item.sort_order,
    })) : [],
    recentVotes: votes.results.map((vote) => ({ id: vote.id, nickname: vote.nickname, minecraftUuid: vote.minecraft_uuid, rewardStatus: vote.reward_status, createdAt: vote.created_at })),
    monthlyTop: monthly.results.map((item) => ({ nickname: item.nickname, minecraftUuid: item.minecraft_uuid, count: Number(item.count) })),
    trend: trend.results.map((point) => ({
      bucketAt: Number(point.bucket_at),
      day: new Date(Number(point.bucket_at) * 1000).toISOString(),
      players: Number(point.players),
      maxPlayers: Number(point.max_players),
      samples: 1,
      source: point.source,
    })),
    trendSource,
  } satisfies PublicServer;
}

export function parseStaffProfiles(value: unknown): Array<Omit<PublicStaffProfile, "id" | "sortOrder">> {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) throw Response.json({ error: "운영진은 최대 12명까지 등록할 수 있습니다." }, { status: 400 });
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw Response.json({ error: "운영진 정보를 확인해 주세요." }, { status: 400 });
    const item = raw as Record<string, unknown>;
    const role = clean(item.role, 1, 30, "운영진 직급");
    const nickname = clean(item.nickname, 3, 16, "운영진 닉네임");
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) throw Response.json({ error: "운영진 닉네임은 Minecraft Java 닉네임 형식이어야 합니다." }, { status: 400 });
    const introduction = clean(item.introduction, 1, 160, "운영진 소개");
    const discordEnabled = item.discordEnabled === true;
    const discordUrl = item.discordUrl == null || item.discordUrl === ""
      ? ""
      : clean(item.discordUrl, 1, 100, "운영진 개인 Discord 아이디 또는 링크");
    if (discordEnabled && !discordUrl) throw Response.json({ error: `${nickname} 운영진의 Discord 아이디 또는 링크를 입력해 주세요.` }, { status: 400 });
    return { role, nickname, minecraftUuid: null, introduction, discordEnabled, discordUrl };
  });
}

export function normalizePublicUrl(value: unknown, field: string) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 500) throw Response.json({ error: `${field} 주소를 확인해 주세요.` }, { status: 400 });
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") throw new Error("https required");
    return url.toString();
  } catch {
    throw Response.json({ error: `${field} 주소는 https://로 시작해야 합니다.` }, { status: 400 });
  }
}

function publicSelectSql() {
  return `SELECT d.*,
    b.verified_at bridge_verified_at, b.last_seen_at, b.total_players, b.max_players, b.average_ping_ms,
    b.last_ping_attempt_at, b.last_ping_success_at, b.ping_players, b.ping_max_players, b.ping_latency_ms, b.ping_version,
    (SELECT COUNT(*) FROM server_votes v WHERE v.server_id = d.id) vote_count,
    (SELECT MIN(100.0, 100.0 * SUM(CASE WHEN h.online = 1 THEN 1 ELSE 0 END) /
      MAX(1, CAST(((? - MIN(h.bucket_at)) / 300) AS INTEGER) + 1))
      FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ?) history_uptime,
    (SELECT AVG(h.players) FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ?) recent_average,
    (SELECT AVG(h.players) FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ? AND h.bucket_at < ?) previous_average,
    (SELECT COUNT(DISTINCT strftime('%Y-%m-%d', datetime(h.bucket_at + 32400, 'unixepoch')))
      FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ?) history_days,
    (SELECT COUNT(*) FROM server_enforcements e WHERE e.server_id = d.id AND e.kind = 'warning') warning_count,
    (SELECT COUNT(*) FROM server_enforcements e WHERE e.server_id = d.id AND e.kind IN ('suspension', 'blind')) serious_enforcement_count,
    (SELECT COUNT(*) FROM server_enforcements e WHERE e.server_id = d.id AND e.status = 'active') active_enforcement_count,
    EXISTS(SELECT 1 FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'icon') has_icon,
    EXISTS(SELECT 1 FROM server_assets a WHERE a.server_id = d.id AND a.kind IN ('desktopList','mobileList')) has_list_banner,
    EXISTS(SELECT 1 FROM server_assets a WHERE a.server_id = d.id AND a.kind IN ('desktopDetail','mobileDetail')) has_detail_banner,
    (SELECT a.content_type FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'icon' LIMIT 1) icon_content_type,
    (SELECT a.focus_x FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'icon' LIMIT 1) icon_focus_x,
    (SELECT a.focus_y FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'icon' LIMIT 1) icon_focus_y,
    (SELECT a.zoom_percent FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'icon' LIMIT 1) icon_zoom,
    (SELECT a.content_type FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopList' LIMIT 1) desktop_list_content_type,
    (SELECT a.content_type FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileList' LIMIT 1) mobile_list_content_type,
    (SELECT a.content_type FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopDetail' LIMIT 1) desktop_detail_content_type,
    (SELECT a.content_type FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileDetail' LIMIT 1) mobile_detail_content_type,
    (SELECT a.focus_x FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopList' LIMIT 1) desktop_list_focus_x,
    (SELECT a.focus_y FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopList' LIMIT 1) desktop_list_focus_y,
    (SELECT a.zoom_percent FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopList' LIMIT 1) desktop_list_zoom,
    (SELECT a.focus_x FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileList' LIMIT 1) mobile_list_focus_x,
    (SELECT a.focus_y FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileList' LIMIT 1) mobile_list_focus_y,
    (SELECT a.zoom_percent FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileList' LIMIT 1) mobile_list_zoom,
    (SELECT a.focus_x FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopDetail' LIMIT 1) desktop_detail_focus_x,
    (SELECT a.focus_y FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopDetail' LIMIT 1) desktop_detail_focus_y,
    (SELECT a.zoom_percent FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'desktopDetail' LIMIT 1) desktop_detail_zoom,
    (SELECT a.focus_x FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileDetail' LIMIT 1) mobile_detail_focus_x,
    (SELECT a.focus_y FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileDetail' LIMIT 1) mobile_detail_focus_y,
    (SELECT a.zoom_percent FROM server_assets a WHERE a.server_id = d.id AND a.kind = 'mobileDetail' LIMIT 1) mobile_detail_zoom,
    (SELECT award.amount FROM premium_awards award JOIN premium_auctions auction ON auction.id = award.auction_id
      WHERE award.server_id = d.id AND award.status IN ('scheduled', 'active')
        AND auction.target_starts_at = d.premium_starts_at AND auction.target_ends_at = d.premium_ends_at
      ORDER BY award.amount DESC LIMIT 1) premium_bid_amount,
    CASE WHEN d.premium_managed = 1 AND d.premium_tier = 'premium'
      AND (d.premium_starts_at IS NULL OR d.premium_starts_at <= ?)
      AND (d.premium_ends_at IS NULL OR d.premium_ends_at > ?) THEN 1 ELSE 0 END sponsored
    FROM directory_servers d LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id`;
}

function serializePublicRow(row: PublicRow, now: number, includeDescription = true): PublicServer {
  const bridgeOnline = Boolean(row.bridge_verified_at && row.last_seen_at && row.last_seen_at >= now - 120);
  const pingOnline = Boolean(row.bridge_verified_at && row.last_ping_success_at && row.last_ping_success_at >= now - 120);
  const online = bridgeOnline || pingOnline;
  const statusSource: PublicServer["statusSource"] = bridgeOnline ? "bridge" : pingOnline ? "ping" : "none";
  const bridgeStatus: PublicServer["bridgeStatus"] = bridgeOnline ? "live" : row.last_seen_at ? "stale" : "not_connected";
  const baseUptime = row.history_uptime ?? (online ? 100 : 0);
  const uptime = row.uptime_basis_points == null
    ? Math.min(100, Math.max(0, Math.round((baseUptime + Number(row.uptime_adjustment_basis_points ?? 0) / 100) * 100) / 100))
    : row.uptime_basis_points / 100;
  const votes = row.votes_override ?? Math.max(0, Number(row.vote_count ?? 0) + Number(row.votes_adjustment ?? 0));
  const previous = Number(row.previous_average ?? 0);
  const growth = previous > 0 ? Math.round(((Number(row.recent_average ?? 0) - previous) / previous) * 100) : 0;
  const verified = row.owner_verification_status === "verified" && Boolean(row.owner_verified_at);
  const trustResult = calculateTrustScore({
    verified,
    bridgeOnline,
    pingOnline,
    bridgeVerified: Boolean(row.bridge_verified_at),
    bridgeSeen: Boolean(row.last_seen_at),
    lastSignalAt: Math.max(row.last_seen_at ?? 0, row.last_ping_success_at ?? 0) || null,
    observedUptime: row.history_uptime,
    historyDays: Number(row.history_days ?? 0),
    warnings: Number(row.warning_count ?? 0),
    serious: Number(row.serious_enforcement_count ?? 0),
    active: Number(row.active_enforcement_count ?? 0),
    now,
  });
  const tags = readStoredServerCategories(parseStringArray(row.categories));
  const version = row.min_version === row.max_version ? row.min_version : `${row.min_version} — ${row.max_version}`;
  const defaultPort = row.edition === "BE" ? 19132 : 25565;
  return {
    id: row.id,
    name: row.title,
    address: row.port === defaultPort ? row.address : `${row.address}:${row.port}`,
    host: row.address,
    port: row.port,
    edition: row.edition as PublicServer["edition"],
    version,
    summary: row.short_description,
    description: includeDescription ? row.description : "",
    descriptionDocument: includeDescription
      ? readDescriptionDocument(row.description_document, row.description)
      : { version: 1, blocks: [] },
    players: bridgeOnline ? Number(row.total_players ?? 0) : pingOnline ? Number(row.ping_players ?? 0) : 0,
    capacity: bridgeOnline ? Math.max(0, Number(row.max_players ?? 0)) : pingOnline ? Math.max(0, Number(row.ping_max_players ?? 0)) : 0,
    latency: pingOnline ? Math.max(0, Number(row.ping_latency_ms ?? 0)) : bridgeOnline ? Math.max(0, Number(row.average_ping_ms ?? 0)) : 0,
    uptime,
    trust: trustResult.score,
    trustGrade: trustResult.grade,
    trustLabel: trustResult.label,
    trustBreakdown: trustResult.factors,
    enforcementSummary: trustResult.enforcementSummary,
    votes,
    growth,
    averagePlayers7d: row.recent_average == null ? null : Math.max(0, Math.round(Number(row.recent_average))),
    tags,
    verified,
    online,
    statusSource,
    bridgeStatus,
    sponsored: Boolean(row.sponsored),
    hasIcon: Boolean(row.has_icon),
    iconContentType: row.icon_content_type,
    iconTransform: bannerTransform(row.icon_focus_x, row.icon_focus_y, row.icon_zoom),
    hasListBanner: Boolean(row.has_list_banner),
    hasDetailBanner: Boolean(row.has_detail_banner),
    bannerContentTypes: {
      desktopList: row.desktop_list_content_type,
      mobileList: row.mobile_list_content_type,
      desktopDetail: row.desktop_detail_content_type,
      mobileDetail: row.mobile_detail_content_type,
    },
    bannerTransforms: {
      desktopList: bannerTransform(row.desktop_list_focus_x, row.desktop_list_focus_y, row.desktop_list_zoom),
      mobileList: bannerTransform(row.mobile_list_focus_x, row.mobile_list_focus_y, row.mobile_list_zoom),
      desktopDetail: bannerTransform(row.desktop_detail_focus_x, row.desktop_detail_focus_y, row.desktop_detail_zoom),
      mobileDetail: bannerTransform(row.mobile_detail_focus_x, row.mobile_detail_focus_y, row.mobile_detail_zoom),
    },
    discordUrl: row.discord_url ?? "",
    discordEnabled: Boolean(row.discord_enabled),
    websiteUrl: row.website_url ?? "",
    websiteEnabled: Boolean(row.website_enabled),
    kakaoUrl: row.kakao_url ?? "",
    kakaoEnabled: Boolean(row.kakao_enabled),
    staffIntroEnabled: Boolean(row.staff_intro_enabled),
    staff: [],
    recentVotes: [],
    monthlyTop: [],
    trend: [],
    trendSource: "none",
    lastSeenAt: Math.max(row.last_seen_at ?? 0, row.last_ping_success_at ?? 0) || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function calculateTrustScore(input: {
  verified: boolean;
  bridgeOnline: boolean;
  pingOnline: boolean;
  bridgeVerified: boolean;
  bridgeSeen: boolean;
  lastSignalAt: number | null;
  observedUptime: number | null;
  historyDays: number;
  warnings: number;
  serious: number;
  active: number;
  now: number;
}) {
  const historyDays = Math.min(14, Math.max(0, Math.round(input.historyDays)));
  const observedUptime = Math.min(100, Math.max(0, Number(input.observedUptime ?? 0)));
  const coverage = Math.min(1, historyDays / 14);
  const ownershipScore = input.verified ? 25 : 0;
  const bridgeScore = input.bridgeOnline ? 20 : input.pingOnline ? 10
    : input.bridgeVerified && input.bridgeSeen ? 8 : input.bridgeVerified ? 5 : 0;
  const uptimeScore = Math.min(20, Math.max(0, Math.round((observedUptime / 5) * coverage)));
  const signalAge = input.lastSignalAt ? Math.max(0, input.now - input.lastSignalAt) : Number.POSITIVE_INFINITY;
  const recentScore = input.bridgeOnline || input.pingOnline ? 15 : signalAge <= 6 * 3600 ? 10
    : signalAge <= 24 * 3600 ? 6 : signalAge <= 7 * 86_400 ? 2 : 0;
  const warnings = Math.max(0, Math.round(input.warnings));
  const serious = Math.max(0, Math.round(input.serious));
  const active = Math.max(0, Math.round(input.active));
  const policyScore = Math.max(0, 15 - warnings * 4 - serious * 8 - active * 3);
  const historyScore = historyDays ? Math.min(5, Math.ceil((historyDays / 14) * 5)) : 0;
  const factors: PublicTrustFactor[] = [
    trustFactor("ownership", "운영자 소유권", ownershipScore, 25,
      input.verified ? "MOTD·브리지 소유권 인증 완료" : "서버 통제권 인증이 필요합니다."),
    trustFactor("bridge", "브리지·상태 연동", bridgeScore, 20,
      input.bridgeOnline ? "브리지 플러그인이 실시간 데이터를 전송 중입니다."
        : input.pingOnline ? "Minecraft 공개 핑으로 현재 상태를 확인했습니다."
          : input.bridgeVerified && input.bridgeSeen ? "브리지 인증은 완료됐지만 최근 신호가 지연 중입니다."
            : input.bridgeVerified ? "브리지 인증 완료 · 첫 실시간 데이터 대기 중" : "브리지 플러그인이 연결되지 않았습니다."),
    trustFactor("uptime", "30일 실측 가동률", uptimeScore, 20,
      historyDays ? `실측 ${formatTrustUptime(observedUptime)}% · 최근 14일 중 ${historyDays}일 표본 반영` : "가동률 표본을 수집 중입니다."),
    trustFactor("recentStatus", "최근 정상 응답", recentScore, 15,
      input.bridgeOnline || input.pingOnline ? "현재 온라인 응답을 확인했습니다."
        : signalAge <= 7 * 86_400 ? `마지막 정상 신호 ${formatSignalAge(signalAge)} 전` : "최근 7일 이내 정상 신호가 없습니다."),
    {
      ...trustFactor("policy", "운영 정책 준수", policyScore, 15,
        warnings === 0 && serious === 0 && active === 0 ? "누적 경고·임시차단·블라인드 이력이 없습니다."
          : `누적 경고 ${warnings}건 · 임시차단/블라인드 ${serious}건${active ? ` · 활성 제재 ${active}건` : ""}`),
      state: warnings || serious || active ? "penalty" : "earned",
    },
    trustFactor("history", "상태 이력 축적", historyScore, 5,
      historyDays >= 14 ? "최근 14일 상태 이력이 모두 축적되었습니다." : `최근 14일 중 ${historyDays}일 상태 이력 수집`),
  ];
  const score = Math.min(100, Math.max(0, factors.reduce((sum, factor) => sum + factor.score, 0)));
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D";
  const label = grade === "S" ? "매우 우수" : grade === "A" ? "우수" : grade === "B" ? "안정" : grade === "C" ? "보통" : "주의 필요";
  return { score, grade, label, factors, enforcementSummary: { warnings, serious, active } } as const;
}

function trustFactor(key: PublicTrustFactor["key"], label: string, score: number, maxScore: number, detail: string): PublicTrustFactor {
  return { key, label, score, maxScore, detail, state: score >= maxScore ? "earned" : score > 0 ? "partial" : "missing" };
}

function formatTrustUptime(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatSignalAge(seconds: number) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}분`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}시간`;
  return `${Math.round(seconds / 86_400)}일`;
}

type StatusProbeCandidate = {
  id: string;
  bridge_server_id: string;
  address: string;
  port: number;
  ping_max_players: number;
};

const STATUS_BUCKET_SECONDS = 5 * 60;
const INTERACTIVE_STATUS_BATCH_SIZE = 6;
const SCHEDULED_STATUS_BATCH_SIZE = 20;
const MAX_SCHEDULED_STATUS_BATCHES = 50;

async function refreshPublicStatusSnapshots(db: D1Database, now: number, serverId?: string, mode: "interactive" | "scheduled" = "interactive") {
  const staleBefore = now - 45;
  const serverFilter = serverId ? "AND d.id = ?" : "";
  const currentBucketFilter = mode === "scheduled"
    ? "AND NOT EXISTS (SELECT 1 FROM server_status_history current WHERE current.server_id = d.id AND current.bucket_at = ?)"
    : "";
  const bindings: Array<string | number> = [staleBefore];
  if (mode === "scheduled") bindings.push(Math.floor(now / STATUS_BUCKET_SECONDS) * STATUS_BUCKET_SECONDS);
  if (serverId) bindings.push(serverId);
  const batchSize = serverId ? 1 : mode === "scheduled" ? SCHEDULED_STATUS_BATCH_SIZE : INTERACTIVE_STATUS_BATCH_SIZE;
  bindings.push(batchSize);
  const candidates = await db.prepare(`SELECT d.id, d.bridge_server_id, d.address, d.port, b.ping_max_players
    FROM directory_servers d JOIN bridge_servers b ON b.server_id = d.bridge_server_id
    WHERE d.status = 'active' AND d.deleted_at IS NULL AND d.edition <> 'BE'
      AND d.owner_verification_status = 'verified' AND b.verified_at IS NOT NULL
      AND COALESCE(b.last_ping_attempt_at, 0) <= ? ${currentBucketFilter} ${serverFilter}
    ORDER BY COALESCE(b.last_ping_attempt_at, 0) ASC LIMIT ?`)
    .bind(...bindings).all<StatusProbeCandidate>();

  const results = await Promise.allSettled(candidates.results.map(async (candidate) => {
    const claim = await db.prepare(`UPDATE bridge_servers SET last_ping_attempt_at = ?, updated_at = ?
      WHERE server_id = ? AND COALESCE(last_ping_attempt_at, 0) <= ?`)
      .bind(now, now, candidate.bridge_server_id, staleBefore).run();
    if (!claim.meta.changes) return false;
    try {
      const resolvedIps = await assertAddressNotBlacklisted(db, candidate.address, candidate.port);
      const ping = await pingMinecraftServer(candidate.address, candidate.port);
      await db.batch([
        db.prepare(`UPDATE bridge_servers SET last_ping_success_at = ?, ping_players = ?, ping_max_players = ?,
          ping_latency_ms = ?, ping_version = ?, updated_at = ? WHERE server_id = ?`)
          .bind(now, ping.playersOnline, ping.playersMax, ping.latencyMs, ping.version, now, candidate.bridge_server_id),
        db.prepare("UPDATE directory_servers SET resolved_ips = ? WHERE id = ?")
          .bind(JSON.stringify(resolvedIps), candidate.id),
        statusHistoryStatement(db, candidate.id, now, ping.playersOnline, ping.playersMax, ping.latencyMs, true, "ping"),
        db.prepare("DELETE FROM server_status_history WHERE bucket_at < ?").bind(now - 35 * 86_400),
      ]);
      return true;
    } catch {
      try {
        await db.batch([
          statusHistoryStatement(db, candidate.id, now, 0, candidate.ping_max_players, 0, false, "ping"),
          db.prepare("DELETE FROM server_status_history WHERE bucket_at < ?").bind(now - 35 * 86_400),
        ]);
        return true;
      } catch {
        return false;
      }
    }
  }));
  return results.reduce((count, result) => count + (result.status === "fulfilled" && result.value ? 1 : 0), 0);
}

export async function collectPublicStatusSnapshots(db: D1Database) {
  await ensurePublicDirectorySchema(db);
  await synchronizeBlacklist(db);
  await synchronizeServerEnforcements(db);
  await synchronizePremiumAuctions(db);
  const now = unixNow();
  let recorded = 0;
  for (let batch = 0; batch < MAX_SCHEDULED_STATUS_BATCHES; batch += 1) {
    const batchRecorded = await refreshPublicStatusSnapshots(db, now, undefined, "scheduled");
    recorded += batchRecorded;
    if (batchRecorded < SCHEDULED_STATUS_BATCH_SIZE) break;
  }
  return { recorded, bucketAt: Math.floor(now / STATUS_BUCKET_SECONDS) * STATUS_BUCKET_SECONDS };
}

export async function refreshPublicDirectoryInBackground(db: D1Database) {
  await ensurePublicDirectorySchema(db);
  await synchronizeBlacklist(db);
  await synchronizeServerEnforcements(db);
  await synchronizePremiumAuctions(db);
  const now = unixNow();
  const recorded = await refreshPublicStatusSnapshots(db, now, undefined, "scheduled");
  return { recorded, bucketAt: Math.floor(now / STATUS_BUCKET_SECONDS) * STATUS_BUCKET_SECONDS };
}

function statusHistoryStatement(db: D1Database, serverId: string, now: number, players: number, maxPlayers: number,
  latencyMs: number, online: boolean, source: "bridge" | "ping") {
  const bucketAt = Math.floor(now / STATUS_BUCKET_SECONDS) * STATUS_BUCKET_SECONDS;
  return db.prepare(`INSERT INTO server_status_history
    (server_id, bucket_at, players, max_players, latency_ms, online, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id, bucket_at) DO UPDATE SET players = excluded.players,
      max_players = excluded.max_players, latency_ms = excluded.latency_ms,
      online = excluded.online, source = excluded.source
    WHERE server_status_history.source <> 'bridge' OR excluded.source = 'bridge'`)
    .bind(serverId, bucketAt, players, maxPlayers, latencyMs, online ? 1 : 0, source);
}

function parseStringArray(value: string) {
  try {
    const result = JSON.parse(value);
    return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function bannerTransform(focusX: number | null, focusY: number | null, zoom: number | null): PublicBannerTransform {
  return {
    focusX: Math.min(100, Math.max(0, Number(focusX ?? 50))),
    focusY: Math.min(100, Math.max(0, Number(focusY ?? 50))),
    zoom: Math.min(300, Math.max(100, Number(zoom ?? 100))),
  };
}

function clean(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== "string") throw Response.json({ error: `${label}을(를) 입력해 주세요.` }, { status: 400 });
  const result = value.trim();
  if (result.length < min || result.length > max) throw Response.json({ error: `${label}은(는) ${min}-${max}자로 입력해 주세요.` }, { status: 400 });
  return result;
}

function kstDay(timestamp: number) {
  return new Date((timestamp + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
