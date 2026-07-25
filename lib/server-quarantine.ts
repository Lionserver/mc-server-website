import { prepareAuditWrite } from "@/lib/admin-security";

type QuarantinedServer = {
  id: string;
  title: string;
  owner_email: string;
  bridge_server_id: string | null;
  purge_after: number;
};

type QuarantineEnvironment = {
  DB: D1Database;
  MEDIA?: R2Bucket;
};

const PURGE_BATCH_SIZE = 50;
const PURGE_CLAIM_LEASE_SECONDS = 15 * 60;

export async function purgeExpiredServerQuarantines(
  environment: QuarantineEnvironment,
  now = Math.floor(Date.now() / 1000),
) {
  const candidates = await environment.DB.prepare(`SELECT d.id, d.title, d.owner_email,
      d.bridge_server_id, d.purge_after
    FROM directory_servers d
    WHERE d.deleted_at IS NOT NULL
      AND (d.purged_at IS NULL OR (d.purged_at < 0 AND d.purged_at > ?))
      AND d.purge_after IS NOT NULL AND d.purge_after <= ?
      AND NOT EXISTS (
        SELECT 1 FROM premium_bids b
        WHERE b.server_id = d.id AND b.status IN ('active', 'winner_pending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM premium_awards a
        WHERE a.server_id = d.id AND a.status IN ('payment_pending', 'scheduled', 'active')
      )
      AND NOT EXISTS (
        SELECT 1 FROM premium_placements p
        WHERE p.server_id = d.id AND p.status IN ('scheduled', 'active')
      )
    ORDER BY d.purge_after ASC, d.id ASC
    LIMIT ?`).bind(-(now - PURGE_CLAIM_LEASE_SECONDS), now, PURGE_BATCH_SIZE).all<QuarantinedServer>();

  let purged = 0;
  let deletedObjects = 0;
  const failures: Array<{ serverId: string; message: string }> = [];
  for (const server of candidates.results) {
    const marker = -Math.max(1, now);
    try {
    const claimed = await environment.DB.prepare(`UPDATE directory_servers SET purged_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after <= ?
        AND (purged_at IS NULL OR (purged_at < 0 AND purged_at > ?))
        AND NOT EXISTS (
          SELECT 1 FROM premium_bids
          WHERE server_id = directory_servers.id AND status IN ('active', 'winner_pending')
        )
        AND NOT EXISTS (
          SELECT 1 FROM premium_awards
          WHERE server_id = directory_servers.id AND status IN ('payment_pending', 'scheduled', 'active')
        )
        AND NOT EXISTS (
          SELECT 1 FROM premium_placements
          WHERE server_id = directory_servers.id AND status IN ('scheduled', 'active')
        )`)
      .bind(marker, now, server.id, now, -(now - PURGE_CLAIM_LEASE_SECONDS)).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;

    const assets = await environment.DB.prepare(`SELECT object_key FROM server_assets WHERE server_id = ?
      UNION SELECT object_key FROM server_description_assets WHERE server_id = ?`)
      .bind(server.id, server.id).all<{ object_key: string }>();
    if (assets.results.length > 0 && !environment.MEDIA) {
      throw new Error(`MEDIA binding is unavailable for server quarantine purge (${server.id})`);
    }
    if (environment.MEDIA) {
      await Promise.all(assets.results.map((asset) => environment.MEDIA?.delete(asset.object_key)));
      deletedObjects += assets.results.length;
    }

    const guard = `EXISTS (
      SELECT 1 FROM directory_servers d
      WHERE d.id = ? AND d.deleted_at IS NOT NULL AND d.purged_at = ?
    )`;
    const statements: D1PreparedStatement[] = [
      environment.DB.prepare(`DELETE FROM server_assets WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM server_description_assets WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM server_staff_profiles WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM server_votes WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM server_status_history WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM admin_messages WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM operator_channel_messages WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM admin_conversations WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM chat_realtime_tickets WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM server_ownership_transfers WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
      environment.DB.prepare(`DELETE FROM server_ownership_claims WHERE server_id = ? AND ${guard}`)
        .bind(server.id, server.id, marker),
    ];
    if (server.bridge_server_id) {
      statements.push(
        environment.DB.prepare(`DELETE FROM bridge_backends WHERE server_id = ? AND ${guard}`)
          .bind(server.bridge_server_id, server.id, marker),
        environment.DB.prepare(`DELETE FROM bridge_nonces WHERE server_id = ? AND ${guard}`)
          .bind(server.bridge_server_id, server.id, marker),
        environment.DB.prepare(`DELETE FROM bridge_telemetry_history WHERE server_id = ? AND ${guard}`)
          .bind(server.bridge_server_id, server.id, marker),
        environment.DB.prepare(`DELETE FROM bridge_servers WHERE server_id = ? AND ${guard}`)
          .bind(server.bridge_server_id, server.id, marker),
      );
    }
    statements.push(
      environment.DB.prepare(`UPDATE directory_servers SET
          owner_email = ?, title = '삭제된 서버', short_description = '', description = '',
          description_document = '', address = ?, port = 25565, categories = '[]',
          status = 'deleted', bridge_server_id = NULL,
          owner_verification_status = 'unverified', owner_verified_at = NULL,
          votes_override = NULL, votes_adjustment = 0,
          uptime_basis_points = NULL, uptime_adjustment_basis_points = 0,
          premium_managed = 0, premium_tier = 'none', premium_starts_at = NULL,
          premium_ends_at = NULL, premium_note = '',
          discord_url = '', discord_enabled = 0, website_url = '', website_enabled = 0,
          kakao_url = '', kakao_enabled = 0, staff_intro_enabled = 0,
          resolved_ips = '[]', status_before_blacklist = NULL,
          status_before_enforcement = NULL, status_before_deletion = NULL,
          deletion_reason = '7일 복구 기간 만료 후 영구 정리',
          deleted_by = NULL, purged_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NOT NULL AND purged_at = ?`)
        .bind(`purged+${server.id}@invalid.local`, `purged-${server.id}.invalid`, now, now, server.id, marker),
      prepareAuditWrite(environment.DB, "system@minecraft.kr", "server.quarantine.purged", "server", server.id, {
        previousTitle: server.title,
        previousOwner: server.owner_email,
        purgeAfter: server.purge_after,
        deletedObjects: assets.results.length,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    );
    const results = await environment.DB.batch(statements);
    if ((results.at(-2)?.meta.changes ?? 0) !== 1) {
      throw new Error("격리 정리 claim이 완료 전에 변경되었습니다.");
    }
    purged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 격리 정리 오류";
      if (message.startsWith("MEDIA binding is unavailable")) throw error;
      failures.push({ serverId: server.id, message: message.replace(/\s+/g, " ").slice(0, 180) });
    }
  }

  const remaining = await environment.DB.prepare(`SELECT COUNT(*) count FROM directory_servers
    WHERE deleted_at IS NOT NULL AND (purged_at IS NULL OR purged_at < 0)
      AND purge_after IS NOT NULL AND purge_after <= ?`).bind(now).first<{ count: number }>();
  if (failures.length > 0) {
    throw new Error(`격리 서버 ${failures.length}건 정리 실패: ${failures
      .slice(0, 5)
      .map((failure) => `${failure.serverId.slice(0, 8)} ${failure.message}`)
      .join("; ")}`);
  }
  return {
    purged,
    deletedObjects,
    remainingEligible: Number(remaining?.count ?? 0),
    hasMore: Number(remaining?.count ?? 0) > 0,
    batchLimit: PURGE_BATCH_SIZE,
  };
}
