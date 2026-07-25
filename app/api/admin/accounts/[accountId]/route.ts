import {
  adminErrorResponse,
  prepareAuditWrite,
  requireAdmin,
} from "@/lib/admin-security";
import { ensurePremiumAuctionSchema } from "@/lib/premium-auction";
import { ensureUserAuthSchema } from "@/lib/user-auth";
import { disconnectChatPrincipal } from "@/lib/chat-realtime-control";

type RouteContext = { params: Promise<{ accountId: string }> | { accountId: string } };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(accountId)) {
      throw Response.json({ error: "유효하지 않은 계정 ID입니다." }, { status: 400 });
    }
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    await ensureUserAuthSchema(environment.DB);
    await ensurePremiumAuctionSchema(environment.DB);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === "suspend" ? "suspend" : body.action === "restore" ? "restore" : "";
    if (!action) throw Response.json({ error: "계정 정지 또는 복구 작업을 선택해 주세요." }, { status: 400 });

    const account = await environment.DB.prepare(`SELECT id, email, account_status, suspended_at,
      suspended_by, suspension_reason FROM user_accounts WHERE id = ?`)
      .bind(accountId).first<{
        id: string; email: string; account_status: string; suspended_at: number | null;
        suspended_by: string | null; suspension_reason: string;
      }>();
    if (!account) return Response.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });

    const now = Math.floor(Date.now() / 1000);
    if (action === "suspend") {
      const reason = cleanSuspensionReason(body.reason);
      if (account.account_status === "suspended") {
        return Response.json({ error: "이미 정지된 계정입니다." }, { status: 409 });
      }
      const ownedServers = await environment.DB.prepare("SELECT id FROM directory_servers WHERE owner_email = ?")
        .bind(account.email).all<{ id: string }>();
      const results = await environment.DB.batch([
        environment.DB.prepare(`UPDATE user_accounts SET account_status = 'suspended', suspended_at = ?,
          suspended_by = ?, suspension_reason = ?, updated_at = ?
          WHERE id = ? AND account_status = 'active'`)
          .bind(now, session.email, reason, now, accountId),
        prepareAuditWrite(environment.DB, session.email, "account.suspended", "user_account", accountId, {
          email: account.email,
          reason,
        }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
        environment.DB.prepare("DELETE FROM user_sessions WHERE account_id = ?").bind(accountId),
        environment.DB.prepare(`DELETE FROM user_login_codes
          WHERE email = ? AND consumed_at IS NULL`).bind(account.email),
        environment.DB.prepare(`DELETE FROM chat_realtime_tickets
          WHERE role = 'owner' AND principal_email = ?`).bind(account.email),
        environment.DB.prepare(`UPDATE premium_bids SET status = 'cancelled_account', updated_at = ?
          WHERE owner_email = ? AND status IN ('active', 'winner_pending')`).bind(now, account.email),
        environment.DB.prepare(`UPDATE premium_awards SET status = 'account_suspended', updated_at = ?, confirmed_by = ?
          WHERE owner_email = ? AND status IN ('payment_pending', 'scheduled', 'active')`)
          .bind(now, session.email, account.email),
        environment.DB.prepare(`UPDATE premium_placements SET status = 'account_suspended', updated_at = ?
          WHERE owner_email = ? AND status IN ('scheduled', 'active')`).bind(now, account.email),
        environment.DB.prepare(`UPDATE directory_servers SET premium_managed = 0, premium_tier = 'none',
          premium_starts_at = NULL, premium_ends_at = NULL, premium_note = '', updated_at = ?
          WHERE owner_email = ?`).bind(now, account.email),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        return Response.json({ error: "계정 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      }
      const realtimeDisconnected = await disconnectChatPrincipal(environment, {
        role: "owner",
        principalEmail: account.email,
        serverIds: ownedServers.results.map((server) => server.id),
      }).catch(() => 0);
      return Response.json({
        status: "suspended",
        suspendedAt: now,
        sessionsRevoked: Math.max(0, Number(results[2]?.meta.changes ?? 0)),
        realtimeDisconnected,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (account.account_status !== "suspended") {
      return Response.json({ error: "정지 상태인 계정만 복구할 수 있습니다." }, { status: 409 });
    }
    const reason = optionalRestoreReason(body.reason);
    const results = await environment.DB.batch([
      environment.DB.prepare(`UPDATE user_accounts SET account_status = 'active', suspended_at = NULL,
        suspended_by = NULL, suspension_reason = '', updated_at = ?
        WHERE id = ? AND account_status = 'suspended'`).bind(now, accountId),
      prepareAuditWrite(environment.DB, session.email, "account.restored", "user_account", accountId, {
        email: account.email,
        previousReason: account.suspension_reason,
        reason,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "계정 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    return Response.json({ status: "active" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function cleanSuspensionReason(value: unknown) {
  if (typeof value !== "string") {
    throw Response.json({ error: "계정 정지 사유를 입력해 주세요." }, { status: 400 });
  }
  const reason = value.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw Response.json({ error: "계정 정지 사유는 2-500자로 입력해 주세요." }, { status: 400 });
  }
  return reason;
}

function optionalRestoreReason(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > 500) {
    throw Response.json({ error: "계정 복구 메모는 500자 이하여야 합니다." }, { status: 400 });
  }
  return value.trim();
}
