import { adminErrorResponse, ensureAdminSchema } from "@/lib/admin-security";
import { directoryEnv } from "@/lib/server-directory";
import { synchronizePremiumAuctions } from "@/lib/premium-auction";

type StateRow = {
  id: string; status: string; deleted_at: number | null; votes_override: number | null;
  votes_adjustment: number; vote_count: number; uptime_basis_points: number | null; uptime_adjustment_basis_points: number;
  history_uptime: number | null; premium_managed: number; premium_tier: string;
  bridge_verified_at: number | null; last_seen_at: number | null; last_ping_success_at: number | null;
  premium_starts_at: number | null; premium_ends_at: number | null;
};

export async function GET(request: Request) {
  try {
    const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean))];
    if (ids.length < 1 || ids.length > 50 || ids.some((id) => !/^[a-f0-9]{32}$/.test(id))) {
      return Response.json({ error: "유효한 서버 ID를 1-50개 전달해 주세요." }, { status: 400 });
    }
    const environment = await directoryEnv();
    await ensureAdminSchema(environment.DB);
    await synchronizePremiumAuctions(environment.DB);
    const placeholders = ids.map(() => "?").join(",");
    const now = Math.floor(Date.now() / 1000);
    const rows = await environment.DB.prepare(`SELECT d.id, d.status, d.deleted_at, d.votes_override, d.votes_adjustment,
      d.uptime_basis_points, d.uptime_adjustment_basis_points, d.premium_managed, d.premium_tier,
      d.premium_starts_at, d.premium_ends_at, b.verified_at bridge_verified_at, b.last_seen_at, b.last_ping_success_at,
      (SELECT COUNT(*) FROM server_votes v WHERE v.server_id = d.id) vote_count,
      (SELECT MIN(100.0, 100.0 * SUM(CASE WHEN h.online = 1 THEN 1 ELSE 0 END) /
        MAX(1, CAST(((? - MIN(h.bucket_at)) / 300) AS INTEGER) + 1))
        FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ?) history_uptime
      FROM directory_servers d LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
      WHERE d.id IN (${placeholders})`).bind(now, now - 30 * 86_400, ...ids).all<StateRow>();
    return Response.json({ states: rows.results.map((row) => ({
      id: row.id,
      hidden: Boolean(row.deleted_at || row.status === "deleted" || row.status === "blacklisted"),
      votesOverride: row.votes_override,
      votes: row.votes_override ?? Math.max(0, Number(row.vote_count ?? 0) + Number(row.votes_adjustment ?? 0)),
      votesAdjustment: Number(row.votes_adjustment ?? 0),
      uptime: row.uptime_basis_points == null
        ? Math.min(100, Math.max(0, Number(row.history_uptime ?? (row.bridge_verified_at && ((row.last_seen_at ?? 0) >= now - 120 || (row.last_ping_success_at ?? 0) >= now - 120) ? 100 : 0)) + Number(row.uptime_adjustment_basis_points ?? 0) / 100))
        : row.uptime_basis_points / 100,
      uptimeAdjustment: Number(row.uptime_adjustment_basis_points ?? 0) / 100,
      premiumManaged: Boolean(row.premium_managed),
      premiumActive: Boolean(row.premium_managed && row.premium_tier === "premium"
        && (!row.premium_starts_at || row.premium_starts_at <= now) && (!row.premium_ends_at || row.premium_ends_at >= now)),
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
