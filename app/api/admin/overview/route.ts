import { adminErrorResponse, requireAdmin, synchronizeBlacklist, synchronizeServerEnforcements } from "@/lib/admin-security";
import { adminOwnershipDashboard } from "@/lib/server-ownership";
import { listSiteAnnouncements } from "@/lib/site-announcements";

type ServerRow = {
  id: string; owner_email: string; title: string; address: string; port: number; status: string;
  votes_override: number | null; uptime_basis_points: number | null; premium_managed: number;
  votes_adjustment: number; uptime_adjustment_basis_points: number; vote_count: number; history_uptime: number | null;
  premium_tier: string; premium_starts_at: number | null; premium_ends_at: number | null; premium_note: string;
  updated_at: number; deleted_at: number | null; total_players: number | null; max_players: number | null;
  average_ping_ms: number | null; last_seen_at: number | null; last_ping_success_at: number | null; bridge_verified_at: number | null;
  owner_verification_status: string; owner_verified_at: number | null;
};

type OverviewStatsRow = {
  total_servers: number;
  premium_servers: number;
  blacklisted_servers: number;
  active_enforcements: number;
  unread_messages: number;
  pending_ownership: number;
  unverified_accounts: number;
};

export async function GET(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request);
    await synchronizeBlacklist(environment.DB);
    await synchronizeServerEnforcements(environment.DB);
    const ownership = await adminOwnershipDashboard(environment.DB);
    const now = Math.floor(Date.now() / 1000);
    const [servers, blacklist, enforcements, conversations, audits, identities, announcements, exactStats] = await Promise.all([
      environment.DB.prepare(`SELECT d.id, d.owner_email, d.title, d.address, d.port, d.status,
        d.votes_override, d.votes_adjustment, d.uptime_basis_points, d.uptime_adjustment_basis_points, d.premium_managed, d.premium_tier,
        d.premium_starts_at, d.premium_ends_at, d.premium_note, d.owner_verification_status, d.owner_verified_at,
        d.updated_at, d.deleted_at,
        (SELECT COUNT(*) FROM server_votes v WHERE v.server_id = d.id) vote_count,
        (SELECT MIN(100.0, 100.0 * SUM(CASE WHEN h.online = 1 THEN 1 ELSE 0 END) /
          MAX(1, CAST(((? - MIN(h.bucket_at)) / 300) AS INTEGER) + 1))
          FROM server_status_history h WHERE h.server_id = d.id AND h.bucket_at >= ?) history_uptime,
        b.total_players, b.max_players, b.average_ping_ms, b.last_seen_at, b.last_ping_success_at, b.verified_at bridge_verified_at
        FROM directory_servers d LEFT JOIN bridge_servers b ON b.server_id = d.bridge_server_id
        ORDER BY CASE WHEN d.deleted_at IS NULL THEN 0 ELSE 1 END, d.updated_at DESC LIMIT 500`).bind(now, now - 30 * 86_400).all<ServerRow>(),
      environment.DB.prepare(`SELECT id, kind, value, reason, status, expires_at, created_by, created_at, updated_at
        FROM server_blacklist
        WHERE status = 'active'
          OR id IN (SELECT id FROM server_blacklist ORDER BY created_at DESC LIMIT 300)
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC`).all(),
      environment.DB.prepare(`SELECT e.id, e.server_id, e.kind, e.reason, e.status, e.starts_at, e.expires_at,
        e.created_by, e.resolved_by, e.resolved_at, e.resolution_note, e.created_at, e.updated_at,
        d.title server_title, d.owner_email, d.address, d.port
        FROM server_enforcements e JOIN directory_servers d ON d.id = e.server_id
        WHERE d.deleted_at IS NULL AND (
          e.status = 'active'
          OR e.id IN (SELECT id FROM server_enforcements ORDER BY created_at DESC LIMIT 500)
        )
        ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END, e.created_at DESC`).all(),
      environment.DB.prepare(`SELECT c.server_id, c.status, c.unread_admin, c.unread_owner, c.last_message_at,
        c.updated_at, d.title, d.owner_email,
        (SELECT body FROM admin_messages m WHERE m.server_id = c.server_id ORDER BY m.created_at DESC LIMIT 1) last_message
        FROM admin_conversations c JOIN directory_servers d ON d.id = c.server_id
        WHERE d.deleted_at IS NULL
        ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC LIMIT 200`).all(),
      environment.DB.prepare(`SELECT id, admin_email, action, target_type, target_id, details, created_at
        FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200`).all(),
      environment.DB.prepare(`SELECT id, email, email_verified_at, last_login_at, identity_verification_status,
        identity_verified_at, identity_provider,
        CASE
          WHEN identity_reference = '' THEN ''
          WHEN length(identity_reference) <= 4 THEN '••••'
          ELSE '••••' || substr(identity_reference, -4)
        END identity_reference_masked,
        created_at, updated_at
        FROM user_accounts ORDER BY updated_at DESC LIMIT 500`).all(),
      listSiteAnnouncements(environment.DB),
      environment.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM directory_servers
          WHERE deleted_at IS NULL AND status NOT IN ('blacklisted', 'suspended', 'blinded')) total_servers,
        (SELECT COUNT(*) FROM directory_servers
          WHERE deleted_at IS NULL AND status NOT IN ('blacklisted', 'suspended', 'blinded')
            AND premium_managed = 1 AND premium_tier = 'premium'
            AND (premium_starts_at IS NULL OR premium_starts_at = 0 OR premium_starts_at <= ?)
            AND (premium_ends_at IS NULL OR premium_ends_at = 0 OR premium_ends_at >= ?)) premium_servers,
        (SELECT COUNT(*) FROM directory_servers
          WHERE deleted_at IS NULL AND status = 'blacklisted') blacklisted_servers,
        (SELECT COUNT(*) FROM server_enforcements e
          JOIN directory_servers d ON d.id = e.server_id
          WHERE d.deleted_at IS NULL AND e.status = 'active') active_enforcements,
        (SELECT COALESCE(SUM(c.unread_admin), 0) FROM admin_conversations c
          JOIN directory_servers d ON d.id = c.server_id WHERE d.deleted_at IS NULL) unread_messages,
        (SELECT COUNT(*) FROM server_ownership_claims c
          JOIN directory_servers d ON d.id = c.server_id
          WHERE d.deleted_at IS NULL AND c.status = 'pending_review') pending_ownership,
        (SELECT COUNT(*) FROM user_accounts
          WHERE identity_verification_status <> 'verified') unverified_accounts`)
        .bind(now, now).first<OverviewStatsRow>(),
    ]);
    const serverResults = servers.results.map((row) => {
      const baseVotes = Number(row.vote_count ?? 0);
      const onlineFallback = Boolean(row.bridge_verified_at && ((row.last_seen_at ?? 0) >= now - 120 || (row.last_ping_success_at ?? 0) >= now - 120)) ? 100 : 0;
      const baseUptime = Math.round(Number(row.history_uptime ?? onlineFallback) * 100) / 100;
      const votesAdjustment = Number(row.votes_adjustment ?? 0);
      const uptimeAdjustment = Number(row.uptime_adjustment_basis_points ?? 0) / 100;
      return {
      id: row.id, ownerEmail: row.owner_email, title: row.title, address: row.address, port: row.port,
      status: row.status, deletedAt: row.deleted_at, votesOverride: row.votes_override,
      baseVotes, votesAdjustment,
      votes: row.votes_override ?? Math.max(0, baseVotes + votesAdjustment),
      baseUptime, uptimeAdjustment,
      uptimeOverride: row.uptime_basis_points == null ? null : row.uptime_basis_points / 100,
      uptime: row.uptime_basis_points == null ? Math.min(100, Math.max(0, baseUptime + uptimeAdjustment)) : row.uptime_basis_points / 100,
      premiumManaged: Boolean(row.premium_managed), premiumTier: row.premium_tier,
      premiumStartsAt: row.premium_starts_at, premiumEndsAt: row.premium_ends_at, premiumNote: row.premium_note,
      premiumActive: Boolean(row.premium_managed && row.premium_tier === "premium"
        && (!row.premium_starts_at || row.premium_starts_at <= now) && (!row.premium_ends_at || row.premium_ends_at >= now)),
      updatedAt: row.updated_at, players: row.total_players, maxPlayers: row.max_players,
      averagePingMs: row.average_ping_ms, lastSeenAt: row.last_seen_at,
      ownerVerificationStatus: row.owner_verification_status, ownerVerifiedAt: row.owner_verified_at,
    };
    });
    return Response.json({
      admin: {
        email: session.email,
        expiresAt: session.expiresAt,
        elevatedUntil: session.elevatedUntil,
        authMode: session.authMode,
      },
      stats: {
        totalServers: Number(exactStats?.total_servers ?? 0),
        premiumServers: Number(exactStats?.premium_servers ?? 0),
        blacklistedServers: Number(exactStats?.blacklisted_servers ?? 0),
        activeEnforcements: Number(exactStats?.active_enforcements ?? 0),
        unreadMessages: Number(exactStats?.unread_messages ?? 0),
        pendingOwnership: Number(exactStats?.pending_ownership ?? 0),
        unverifiedAccounts: Number(exactStats?.unverified_accounts ?? 0),
      },
      servers: serverResults,
      blacklist: blacklist.results,
      enforcements: enforcements.results,
      conversations: conversations.results,
      audits: audits.results.map((entry) => ({
        ...entry,
        details: parseDetails((entry as { details?: string }).details),
      })),
      identities: identities.results,
      announcements,
      ownership,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function parseDetails(value: string | undefined) {
  try { return JSON.parse(value ?? "{}"); } catch { return {}; }
}
