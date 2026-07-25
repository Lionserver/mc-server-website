import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";

type ServerRow = {
  id: string;
  owner_email: string;
  title: string;
  address: string;
  port: number;
  status: string;
  votes_override: number | null;
  votes_adjustment: number;
  uptime_basis_points: number | null;
  uptime_adjustment_basis_points: number;
  premium_managed: number;
  premium_tier: string;
  premium_starts_at: number | null;
  premium_ends_at: number | null;
  premium_note: string;
  updated_at: number;
  deleted_at: number | null;
  status_before_deletion: string | null;
  deletion_reason: string;
  deleted_by: string | null;
  purge_after: number | null;
  purged_at: number | null;
  vote_count: number;
  history_uptime: number | null;
  total_players: number | null;
  max_players: number | null;
  average_ping_ms: number | null;
  last_seen_at: number | null;
  last_ping_success_at: number | null;
  bridge_verified_at: number | null;
  owner_verification_status: string;
  owner_verified_at: number | null;
};

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const status = normalizeStatus(url.searchParams.get("status"));
    const { page, pageSize, offset } = paginationFrom(url);
    const now = Math.floor(Date.now() / 1000);

    const where: string[] = ["1 = 1"];
    const bindings: Array<string | number> = [];
    if (status) {
      where.push("d.status = ?");
      bindings.push(status);
    }
    if (query) {
      where.push(`(instr(lower(d.id), lower(?)) > 0
        OR instr(lower(d.title), lower(?)) > 0
        OR instr(lower(d.address), lower(?)) > 0
        OR instr(lower(d.owner_email), lower(?)) > 0
        OR instr(CAST(d.port AS TEXT), ?) > 0)`);
      bindings.push(query, query, query, query, query);
    }
    const whereSql = where.join(" AND ");

    const [rows, count] = await Promise.all([
      environment.DB.prepare(`SELECT d.id, d.owner_email, d.title, d.address, d.port, d.status,
        d.votes_override, d.votes_adjustment, d.uptime_basis_points, d.uptime_adjustment_basis_points,
        d.premium_managed, d.premium_tier, d.premium_starts_at, d.premium_ends_at, d.premium_note,
        d.owner_verification_status, d.owner_verified_at, d.updated_at, d.deleted_at,
        d.status_before_deletion, d.deletion_reason, d.deleted_by, d.purge_after, d.purged_at,
        (SELECT COUNT(*) FROM server_votes v WHERE v.server_id = d.id) vote_count,
        (SELECT MIN(100.0, 100.0 * SUM(CASE WHEN h.online = 1 THEN 1 ELSE 0 END) /
          MAX(1, CAST(((? - MIN(h.bucket_at)) / 300) AS INTEGER) + 1))
          FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ?) history_uptime,
        b.total_players, b.max_players, b.average_ping_ms, b.last_seen_at, b.last_ping_success_at,
        b.verified_at bridge_verified_at
        FROM directory_servers d LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
        WHERE ${whereSql}
        ORDER BY CASE WHEN d.deleted_at IS NULL THEN 0 ELSE 1 END, d.updated_at DESC, d.id ASC
        LIMIT ? OFFSET ?`)
        .bind(now, now - 30 * 86_400, ...bindings, pageSize, offset).all<ServerRow>(),
      environment.DB.prepare(`SELECT COUNT(*) count FROM directory_servers d WHERE ${whereSql}`)
        .bind(...bindings).first<{ count: number }>(),
    ]);

    const total = Number(count?.count ?? 0);
    return Response.json({
      items: rows.results.map((row) => serializeServer(row, now)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    }, { headers: noStoreHeaders() });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function serializeServer(row: ServerRow, now: number) {
  const baseVotes = Number(row.vote_count ?? 0);
  const onlineFallback = Boolean(row.bridge_verified_at
    && ((row.last_seen_at ?? 0) >= now - 120 || (row.last_ping_success_at ?? 0) >= now - 120)) ? 100 : 0;
  const baseUptime = Math.round(Number(row.history_uptime ?? onlineFallback) * 100) / 100;
  const votesAdjustment = Number(row.votes_adjustment ?? 0);
  const uptimeAdjustment = Number(row.uptime_adjustment_basis_points ?? 0) / 100;
  const premiumActive = Boolean(row.premium_managed && row.premium_tier === "premium"
    && (!row.premium_starts_at || row.premium_starts_at <= now)
    && (!row.premium_ends_at || row.premium_ends_at >= now));

  return {
    id: row.id,
    ownerEmail: row.owner_email,
    title: row.title,
    address: row.address,
    port: row.port,
    status: row.status,
    deletedAt: row.deleted_at,
    statusBeforeDeletion: row.status_before_deletion,
    deletionReason: row.deletion_reason,
    deletedBy: row.deleted_by,
    purgeAfter: row.purge_after,
    purgedAt: row.purged_at,
    recoveryExpired: row.purge_after != null && row.purge_after <= now,
    votesOverride: row.votes_override,
    baseVotes,
    votesAdjustment,
    votes: row.votes_override ?? Math.max(0, baseVotes + votesAdjustment),
    baseUptime,
    uptimeAdjustment,
    uptimeOverride: row.uptime_basis_points == null ? null : row.uptime_basis_points / 100,
    uptime: row.uptime_basis_points == null
      ? Math.min(100, Math.max(0, baseUptime + uptimeAdjustment))
      : row.uptime_basis_points / 100,
    premiumManaged: Boolean(row.premium_managed),
    premiumTier: row.premium_tier,
    premiumStartsAt: row.premium_starts_at,
    premiumEndsAt: row.premium_ends_at,
    premiumNote: row.premium_note,
    premiumActive,
    updatedAt: row.updated_at,
    players: row.total_players,
    maxPlayers: row.max_players,
    averagePingMs: row.average_ping_ms,
    lastSeenAt: row.last_seen_at,
    ownerVerificationStatus: row.owner_verification_status,
    ownerVerifiedAt: row.owner_verified_at,
  };
}

function normalizeStatus(value: string | null) {
  const status = (value ?? "").trim().toLowerCase();
  if (!status || status === "all") return "";
  if (!/^[a-z][a-z_]{0,39}$/.test(status)) {
    throw Response.json({ error: "서버 상태 필터가 올바르지 않습니다." }, { status: 400 });
  }
  return status;
}

function paginationFrom(url: URL) {
  const page = boundedInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
  const pageSize = boundedInteger(url.searchParams.get("limit"), 50, 10, 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store", Vary: "Cookie" };
}
