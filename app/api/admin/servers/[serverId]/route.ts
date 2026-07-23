import { adminErrorResponse, requireAdmin, writeAudit } from "@/lib/admin-security";
import { ensureOwnershipSchema } from "@/lib/server-ownership";
import { ensurePremiumAuctionSchema } from "@/lib/premium-auction";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };
type ServerRow = {
  id: string; title: string; status: string; bridge_server_id: string | null; deleted_at: number | null;
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
    const { environment, session } = await requireAdmin(request, { mutating: true });
    await ensureOwnershipSchema(environment.DB);
    await ensurePremiumAuctionSchema(environment.DB);
    const body = await request.json() as Record<string, unknown>;
    const existing = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<ServerRow>();
    if (!existing) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });

    const action = typeof body.action === "string" ? body.action : "";
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
      await environment.DB.prepare(`UPDATE directory_servers SET votes_override = NULL, votes_adjustment = ?,
        uptime_basis_points = NULL, uptime_adjustment_basis_points = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
        .bind(votesAdjustment, uptimeAdjustmentBasisPoints, now, id).run();
      await writeAudit(environment.DB, session.email, action === "reset_metric_adjustments" ? "server.metrics.reset" : "server.metrics.adjusted", "server", id, {
        title: existing.title,
        before: { effectiveVotes: currentVotes, effectiveUptime: currentUptimeBasisPoints / 100 },
        delta: { votes: action === "reset_metric_adjustments" ? null : voteDelta, uptime: action === "reset_metric_adjustments" ? null : uptimeDeltaBasisPoints / 100 },
        after: { effectiveVotes: nextVotes, effectiveUptime: nextUptimeBasisPoints / 100, votesAdjustment, uptimeAdjustment: uptimeAdjustmentBasisPoints / 100 },
      });
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

    await environment.DB.prepare(`UPDATE directory_servers SET votes_override = ?, uptime_basis_points = ?,
      premium_managed = ?, premium_tier = ?, premium_starts_at = ?, premium_ends_at = ?, premium_note = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`)
      .bind(votes, uptimeBasisPoints, premiumChanged ? 1 : existing.premium_managed, premiumTier,
        premiumStartsAt, premiumEndsAt, premiumNote, now, id).run();
    await writeAudit(environment.DB, session.email, "server.controls.updated", "server", id, {
      title: existing.title,
      before: { votesOverride: existing.votes_override, uptimeBasisPoints: existing.uptime_basis_points, premiumTier: existing.premium_tier },
      after: { votesOverride: votes, uptimeBasisPoints, premiumTier, premiumStartsAt, premiumEndsAt },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const id = await serverIdFrom(context);
    const { environment, session } = await requireAdmin(request, { mutating: true });
    await ensureOwnershipSchema(environment.DB);
    await ensurePremiumAuctionSchema(environment.DB);
    const body = await request.json().catch(() => ({})) as { confirmation?: unknown; reason?: unknown };
    const existing = await environment.DB.prepare("SELECT * FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(id).first<ServerRow>();
    if (!existing) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
    if (body.confirmation !== existing.title) return Response.json({ error: "삭제하려면 서버 이름을 정확히 입력해 주세요." }, { status: 400 });
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "총관리자 삭제";
    const assets = await environment.DB.prepare(`SELECT object_key FROM server_assets WHERE server_id = ?
      UNION ALL SELECT object_key FROM server_description_assets WHERE server_id = ?`).bind(id, id).all<{ object_key: string }>();
    const now = Math.floor(Date.now() / 1000);
    const statements = [
      environment.DB.prepare("DELETE FROM server_assets WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_description_assets WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_staff_profiles WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_votes WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM admin_messages WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM operator_channel_messages WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM admin_conversations WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM chat_realtime_tickets WHERE server_id = ?").bind(id),
      environment.DB.prepare(`UPDATE server_enforcements SET status = 'cancelled_server', resolved_by = ?, resolved_at = ?,
        resolution_note = '서버 삭제로 자동 종료', updated_at = ? WHERE server_id = ? AND status = 'active'`).bind(session.email, now, now, id),
      environment.DB.prepare("DELETE FROM server_ownership_transfers WHERE server_id = ?").bind(id),
      environment.DB.prepare("DELETE FROM server_ownership_claims WHERE server_id = ?").bind(id),
      environment.DB.prepare("UPDATE premium_bids SET status = 'cancelled_server', updated_at = ? WHERE server_id = ? AND status = 'active'").bind(now, id),
      environment.DB.prepare("UPDATE premium_awards SET status = 'cancelled_server', updated_at = ?, confirmed_by = ? WHERE server_id = ? AND status IN ('payment_pending', 'scheduled', 'active')").bind(now, session.email, id),
      environment.DB.prepare("UPDATE premium_placements SET status = 'cancelled_server', updated_at = ? WHERE server_id = ? AND status IN ('scheduled', 'active')").bind(now, id),
      environment.DB.prepare("UPDATE directory_servers SET deleted_at = ?, status = 'deleted', bridge_server_id = NULL, updated_at = ? WHERE id = ?")
        .bind(now, now, id),
    ];
    if (existing.bridge_server_id) {
      statements.unshift(
        environment.DB.prepare("DELETE FROM bridge_backends WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_nonces WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_telemetry_history WHERE server_id = ?").bind(existing.bridge_server_id),
        environment.DB.prepare("DELETE FROM bridge_servers WHERE server_id = ?").bind(existing.bridge_server_id),
      );
    }
    await environment.DB.batch(statements);
    if (environment.MEDIA) await Promise.all(assets.results.map((asset) => environment.MEDIA?.delete(asset.object_key).catch(() => undefined)));
    await writeAudit(environment.DB, session.email, "server.deleted", "server", id, { title: existing.title, reason });
    return new Response(null, { status: 204 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function own(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
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
