const DAY_SECONDS = 86_400;

export async function cleanupExpiredApplicationData(db: D1Database, now = Math.floor(Date.now() / 1000)) {
  if (process.env.NODE_ENV !== "production") return { skipped: true, statements: 0 };
  const results = await db.batch([
    db.prepare(`DELETE FROM user_login_codes
      WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`)
      .bind(now - DAY_SECONDS, now - DAY_SECONDS),
    db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM chat_realtime_tickets WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM bridge_nonces WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM admin_login_attempts WHERE updated_at < ?").bind(now - 30 * DAY_SECONDS),
    db.prepare("DELETE FROM minecraft_profiles WHERE expires_at < ?").bind(now - 30 * DAY_SECONDS),
    db.prepare(`UPDATE server_votes
      SET source_fingerprint = 'expired:' || id, source_ip_masked = '', source_ip_hash = '', source_ip_version = 0
      WHERE created_at < ? AND (source_ip_hash <> '' OR source_ip_masked <> '')`)
      .bind(now - 90 * DAY_SECONDS),
    db.prepare("DELETE FROM admin_audit_logs WHERE created_at < ?").bind(now - 3 * 365 * DAY_SECONDS),
    db.prepare(`DELETE FROM admin_messages WHERE created_at < ?
      AND server_id IN (SELECT server_id FROM admin_conversations WHERE status = 'closed')`)
      .bind(now - 3 * 365 * DAY_SECONDS),
    db.prepare("DELETE FROM operator_channel_messages WHERE created_at < ?")
      .bind(now - 3 * 365 * DAY_SECONDS),
    db.prepare("DELETE FROM server_status_history WHERE bucket_at < ?").bind(now - 35 * DAY_SECONDS),
    db.prepare("DELETE FROM bridge_telemetry_history WHERE bucket_at < ?").bind(now - 35 * DAY_SECONDS),
    db.prepare("DELETE FROM security_rate_limits WHERE updated_at < ?").bind(now - 7 * DAY_SECONDS),
  ]);
  return {
    skipped: false,
    statements: results.length,
    changes: results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0),
  };
}
