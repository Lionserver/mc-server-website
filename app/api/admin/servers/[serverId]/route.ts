import {
  adminErrorResponse,
  prepareAuditWrite,
  requireAdmin,
  synchronizeBlacklist,
  synchronizeServerEnforcements,
} from "@/lib/admin-security";
import { broadcastDirectoryUpdate } from "@/lib/directory-realtime";
import { ensureOwnershipSchema } from "@/lib/server-ownership";
import { ensurePremiumAuctionSchema, hasActiveFinancialLock } from "@/lib/premium-auction";
import { disconnectChatPrincipal } from "@/lib/chat-realtime-control";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };
type ServerRow = {
  id: string; owner_email: string; title: string; status: string; bridge_server_id: string | null; deleted_at: number | null;
  address: string; port: number; resolved_ips: string; status_before_deletion: string | null; purge_after: number | null; purged_at: number | null;
  votes_override: number | null; uptime_basis_points: number | null; premium_managed: number;
  votes_adjustment: number; uptime_adjustment_basis_points: number;
  premium_tier: string; premium_starts_at: number | null; premium_ends_at: number | null; premium_note: string;
};

async function serverIdFrom(context: RouteContext) {
  const { serverId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "유효하지 않은 서버 ID입니다." }, { status: 400 });
  return serverId;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const id = await serverIdFrom(context);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const { environment, session } = await requireAdmin(request, {
      mutating: true,
      stepUp: true,
    });
    await ensureOwnershipSchema(environment.DB);
    await ensurePremiumAuctionSchema(environment.DB);
    if (action === "restore") {
      const quarantined = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NOT NULL")
        .bind(id).first<ServerRow>();
      if (!quarantined) return Response.json({ error: "격리된 서버를 찾을 수 없습니다." }, { status: 404 });
      const now = Math.floor(Date.now() / 1000);
      if (quarantined.purged_at != null || quarantined.purge_after == null || quarantined.purge_after <= now) {
        return Response.json({ error: "복구 가능한 7일 격리 기간이 지났습니다." }, { status: 410 });
      }
      const duplicate = await environment.DB.prepare(`SELECT id FROM directory_servers
        WHERE lower(address) = lower(?) AND port = ? AND id <> ? AND deleted_at IS NULL LIMIT 1`)
        .bind(quarantined.address, quarantined.port, id).first<{ id: string }>();
      if (duplicate) {
        return Response.json({ error: "같은 주소와 포트를 사용하는 활성 서버가 있어 복구할 수 없습니다." }, { status: 409 });
      }
      const blacklist = await environment.DB.prepare(`SELECT id, reason FROM server_blacklist
        WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)
          AND ((kind = 'address' AND value = lower(?))
            OR (kind = 'ip' AND instr(lower(?), '"' || lower(value) || '"') > 0))
        LIMIT 1`).bind(now, quarantined.address, quarantined.resolved_ips).first<{ id: string; reason: string }>();
      if (blacklist) {
        return Response.json({
          error: "현재 활성 블랙리스트와 일치해 복구할 수 없습니다. 먼저 차단 항목을 검토해 주세요.",
          blacklistId: blacklist.id,
        }, { status: 409 });
      }
      const restoredStatus = restorableStatus(quarantined.status_before_deletion);
      const results = await environment.DB.batch([
        environment.DB.prepare(`UPDATE directory_servers SET deleted_at = NULL, status = ?,
          status_before_deletion = NULL, deletion_reason = '', deleted_by = NULL,
          purge_after = NULL, purged_at = NULL, updated_at = ?
          WHERE id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL AND purge_after > ?
            AND NOT EXISTS (
              SELECT 1 FROM directory_servers live
              WHERE live.id <> ? AND lower(live.address) = lower(directory_servers.address)
                AND live.port = directory_servers.port AND live.deleted_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM server_blacklist bl
              WHERE bl.status = 'active' AND (bl.expires_at IS NULL OR bl.expires_at > ?)
                AND ((bl.kind = 'address' AND bl.value = lower(directory_servers.address))
                  OR (bl.kind = 'ip' AND instr(lower(directory_servers.resolved_ips), '"' || lower(bl.value) || '"') > 0))
            )`).bind(restoredStatus, now, id, now, id, now),
        prepareAuditWrite(environment.DB, session.email, "server.restored", "server", id, {
          title: quarantined.title,
          status: restoredStatus,
          quarantinedAt: quarantined.deleted_at,
        }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        return Response.json({ error: "서버 격리 상태가 변경되었거나 주소가 중복되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      }
      await synchronizeBlacklist(environment.DB);
      await synchronizeServerEnforcements(environment.DB);
      await broadcastDirectoryUpdate(environment, id, now).catch(() => false);
      return Response.json({ status: restoredStatus, restoredAt: now }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const existing = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<ServerRow>();
    if (!existing) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });

    if (action === "adjust_metrics" || action === "reset_metric_adjustments") {
      const now = Math.floor(Date.now() / 1000);
      const [voteCount, uptimeHistory, liveStatus] = await Promise.all([
        environment.DB.prepare("SELECT COUNT(*) count FROM server_votes WHERE server_id = ?").bind(id).first<{ count: number }>(),
        environment.DB.prepare(`SELECT MIN(100.0, 100.0 * SUM(CASE WHEN online = 1 THEN 1 ELSE 0 END) /
          MAX(1, CAST(((? - MIN(bucket_at)) / 300) AS INTEGER) + 1)) uptime
          FROM server_status_history WHERE server_id = ? AND bucket_at >= ?`)
          .bind(now, id, now - 30 * 86_400).first<{ uptime: number | null }>(),
        existing.bridge_server_id
          ? environment.DB.prepare(`SELECT verified_at, last_seen_at, last_ping_success_at FROM bridge_servers WHERE server_id = ?`)
            .bind(existing.bridge_server_id).first<{ verified_at: number | null; last_seen_at: number | null; last_ping_success_at: number | null }>()
          : Promise.resolve(null),
      ]);
      const baseVotes = Number(voteCount?.count ?? 0);
      const onlineFallback = Boolean(liveStatus?.verified_at && ((liveStatus.last_seen_at ?? 0) >= now - 120 || (liveStatus.last_ping_success_at ?? 0) >= now - 120)) ? 100 : 0;
      const baseUptimeBasisPoints = Math.round(Number(uptimeHistory?.uptime ?? onlineFallback) * 100);
      const currentVotes = existing.votes_override ?? baseVotes + Number(existing.votes_adjustment ?? 0);
      const currentUptimeBasisPoints = existing.uptime_basis_points ?? baseUptimeBasisPoints + Number(existing.uptime_adjustment_basis_points ?? 0);
      const voteDelta = action === "reset_metric_adjustments" ? -Number(existing.votes_adjustment ?? 0) : signedInteger(body.votesDelta, -2_000_000_000, 2_000_000_000, "추천수 증감값");
      const uptimeDeltaBasisPoints = action === "reset_metric_adjustments" ? -Number(existing.uptime_adjustment_basis_points ?? 0) : Math.round(signedNumber(body.uptimeDelta, -100, 100, "업타임 증감값") * 100);
      const nextVotes = action === "reset_metric_adjustments" ? baseVotes : currentVotes + voteDelta;
      const nextUptimeBasisPoints = action === "reset_metric_adjustments" ? baseUptimeBasisPoints : currentUptimeBasisPoints + uptimeDeltaBasisPoints;
      if (nextVotes < 0 || nextVotes > 2_000_000_000) throw Response.json({ error: "조정 후 추천수는 0 이상이어야 합니다." }, { status: 400 });
      if (nextUptimeBasisPoints < 0 || nextUptimeBasisPoints > 10_000) throw Response.json({ error: "조정 후 업타임은 0-100% 범위여야 합니다." }, { status: 400 });
      const votesAdjustment = nextVotes - baseVotes;
      const uptimeAdjustmentBasisPoints = nextUptimeBasisPoints - baseUptimeBasisPoints;
      const results = await environment.DB.batch([
        environment.DB.prepare(`UPDATE directory_servers SET votes_override = NULL, votes_adjustment = ?,
          uptime_basis_points = NULL, uptime_adjustment_basis_points = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
          .bind(votesAdjustment, uptimeAdjustmentBasisPoints, now, id),
        prepareAuditWrite(environment.DB, session.email, action === "reset_metric_adjustments" ? "server.metrics.reset" : "server.metrics.adjusted", "server", id, {
          title: existing.title,
          before: { effectiveVotes: currentVotes, effectiveUptime: currentUptimeBasisPoints / 100 },
          delta: { votes: action === "reset_metric_adjustments" ? null : voteDelta, uptime: action === "reset_metric_adjustments" ? null : uptimeDeltaBasisPoints / 100 },
          after: { effectiveVotes: nextVotes, effectiveUptime: nextUptimeBasisPoints / 100, votesAdjustment, uptimeAdjustment: uptimeAdjustmentBasisPoints / 100 },
        }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        return Response.json({ error: "서버 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      }
      return Response.json({ metrics: { baseVotes, votes: nextVotes, votesAdjustment, baseUptime: baseUptimeBasisPoints / 100, uptime: nextUptimeBasisPoints / 100, uptimeAdjustment: uptimeAdjustmentBasisPoints / 100 } });
    }

    const votes = own(body, "votesOverride") ? nullableInteger(body.votesOverride, 0, 2_000_000_000, "추천수") : existing.votes_override;
    const uptime = own(body, "uptime") ? nullableNumber(body.uptime, 0, 100, "업타임") : existing.uptime_basis_points == null ? null : existing.uptime_basis_points / 100;
    const premiumChanged = ["premiumTier", "premiumStartsAt", "premiumEndsAt", "premiumNote"].some((key) => own(body, key));
    const premiumTier = own(body, "premiumTier") ? String(body.premiumTier) : existing.premium_tier;
    if (!new Set(["none", "premium"]).has(premiumTier)) throw Response.json({ error: "프리미엄 등급 값이 올바르지 않습니다." }, { status: 400 });
    const premiumStartsAt = own(body, "premiumStartsAt") ? nullableTimestamp(body.premiumStartsAt, "광고 시작일") : existing.premium_starts_at;
    const premiumEndsAt = own(body, "premiumEndsAt") ? nullableTimestamp(body.premiumEndsAt, "광고 종료일") : existing.premium_ends_at;
    if (premiumStartsAt && premiumEndsAt && premiumStartsAt >= premiumEndsAt) {
      throw Response.json({ error: "광고 종료일은 시작일 이후여야 합니다." }, { status: 400 });
    }
    const premiumNote = own(body, "premiumNote") ? cleanNote(body.premiumNote) : existing.premium_note;
    const now = Math.floor(Date.now() / 1000);
    const uptimeBasisPoints = uptime == null ? null : Math.round(uptime * 100);

    const results = await environment.DB.batch([
      environment.DB.prepare(`UPDATE directory_servers SET votes_override = ?, uptime_basis_points = ?,
        premium_managed = ?, premium_tier = ?, premium_starts_at = ?, premium_ends_at = ?, premium_note = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`)
        .bind(votes, uptimeBasisPoints, premiumChanged ? 1 : existing.premium_managed, premiumTier,
          premiumStartsAt, premiumEndsAt, premiumNote, now, id),
      prepareAuditWrite(environment.DB, session.email, "server.controls.updated", "server", id, {
        title: existing.title,
        before: { votesOverride: existing.votes_override, uptimeBasisPoints: existing.uptime_basis_points, premiumTier: existing.premium_tier },
        after: { votesOverride: votes, uptimeBasisPoints, premiumTier, premiumStartsAt, premiumEndsAt },
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "서버 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const id = await serverIdFrom(context);
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    await ensureOwnershipSchema(environment.DB);
    await ensurePremiumAuctionSchema(environment.DB);
    const body = await request.json().catch(() => ({})) as { confirmation?: unknown; reason?: unknown };
    const existing = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<ServerRow>();
    if (!existing) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
    if (body.confirmation !== existing.title) return Response.json({ error: "삭제하려면 서버 이름을 정확히 입력해 주세요." }, { status: 400 });
    if (await hasActiveFinancialLock(environment.DB, id)) {
      return Response.json({ error: "진행 중인 입찰·낙찰·프리미엄 광고가 있어 서버를 격리할 수 없습니다." }, { status: 409 });
    }
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : "총관리자 7일 격리";
    const now = Math.floor(Date.now() / 1000);
    const purgeAfter = now + 7 * 86_400;
    const results = await environment.DB.batch([
      environment.DB.prepare(`UPDATE directory_servers SET deleted_at = ?, status_before_deletion = status,
        status = 'deleted', deletion_reason = ?, deleted_by = ?, purge_after = ?, purged_at = NULL, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM premium_bids WHERE server_id = directory_servers.id
              AND status IN ('active', 'winner_pending')
          )
          AND NOT EXISTS (
            SELECT 1 FROM premium_awards WHERE server_id = directory_servers.id
              AND status IN ('payment_pending', 'scheduled', 'active')
          )
          AND NOT EXISTS (
            SELECT 1 FROM premium_placements WHERE server_id = directory_servers.id
              AND status IN ('scheduled', 'active')
          )`)
        .bind(now, reason, session.email, purgeAfter, now, id),
      prepareAuditWrite(environment.DB, session.email, "server.deleted", "server", id, {
        title: existing.title,
        reason,
        quarantine: true,
        purgeAfter,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      environment.DB.prepare(`DELETE FROM chat_realtime_tickets WHERE server_id = ?
        AND EXISTS (
          SELECT 1 FROM directory_servers
          WHERE id = ? AND deleted_at = ? AND deleted_by = ? AND purge_after = ?
        )`).bind(id, id, now, session.email, purgeAfter),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "서버 격리 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    await disconnectChatPrincipal(environment, {
      role: "owner",
      principalEmail: existing.owner_email,
      serverIds: [id],
    }).catch(() => 0);
    await broadcastDirectoryUpdate(environment, id, now).catch(() => false);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store", "X-MKR-Purge-After": String(purgeAfter) },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function own(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function restorableStatus(value: string | null) {
  return value && new Set(["draft", "active", "blacklisted", "suspended", "blinded"]).has(value)
    ? value
    : "draft";
}

function nullableInteger(value: unknown, minimum: number, maximum: number, label: string) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw Response.json({ error: `${label} 범위를 확인해 주세요.` }, { status: 400 });
  return parsed;
}

function signedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  const parsed = value == null || value === "" ? 0 : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw Response.json({ error: `${label} 범위를 확인해 주세요.` }, { status: 400 });
  return parsed;
}

function signedNumber(value: unknown, minimum: number, maximum: number, label: string) {
  const parsed = value == null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw Response.json({ error: `${label} 범위를 확인해 주세요.` }, { status: 400 });
  return parsed;
}

function nullableNumber(value: unknown, minimum: number, maximum: number, label: string) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw Response.json({ error: `${label} 범위를 확인해 주세요.` }, { status: 400 });
  return parsed;
}

function nullableTimestamp(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_600_000_000 || parsed > 4_102_444_800) throw Response.json({ error: `${label} 값이 올바르지 않습니다.` }, { status: 400 });
  return parsed;
}

function cleanNote(value: unknown) {
  if (typeof value !== "string") throw Response.json({ error: "광고 메모 형식이 올바르지 않습니다." }, { status: 400 });
  if (value.trim().length > 500) throw Response.json({ error: "광고 메모는 500자 이하여야 합니다." }, { status: 400 });
  return value.trim();
}
