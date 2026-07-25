import { adminErrorResponse, prepareAuditWrite, requireAdmin } from "@/lib/admin-security";
import { ensurePremiumAuctionSchema } from "@/lib/premium-auction";

type RouteContext = { params: Promise<{ accountId: string }> | { accountId: string } };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { accountId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(accountId)) throw Response.json({ error: "유효하지 않은 계정 ID입니다." }, { status: 400 });
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    await ensurePremiumAuctionSchema(environment.DB);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "verify" ? "verify" : body.action === "revoke" ? "revoke" : "";
    if (!action) throw Response.json({ error: "본인인증 승인 또는 철회를 선택해 주세요." }, { status: 400 });
    const account = await environment.DB.prepare("SELECT id, email, identity_verification_status FROM user_accounts WHERE id = ?")
      .bind(accountId).first<{ id: string; email: string; identity_verification_status: string }>();
    if (!account) return Response.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
    const now = Math.floor(Date.now() / 1000);
    if (action === "verify") {
      const provider = typeof body.provider === "string" ? body.provider.trim().slice(0, 60) : "";
      const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 160) : "";
      if (provider.length < 2 || reference.length < 4) throw Response.json({ error: "본인인증 제공자와 확인번호를 입력해 주세요." }, { status: 400 });
      const results = await environment.DB.batch([
        environment.DB.prepare(`UPDATE user_accounts SET identity_verification_status = 'verified', identity_verified_at = ?,
          identity_provider = ?, identity_reference = ?, updated_at = ? WHERE id = ?`)
          .bind(now, provider, reference, now, accountId),
        prepareAuditWrite(environment.DB, session.email, "identity.verified", "user_account", accountId, {
          email: account.email,
          provider,
          referenceLast4: reference.slice(-4),
        }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        return Response.json({ error: "계정 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      }
      return Response.json({ status: "verified", verifiedAt: now });
    }
    const results = await environment.DB.batch([
      environment.DB.prepare(`UPDATE user_accounts SET identity_verification_status = 'revoked', identity_verified_at = NULL,
        identity_provider = '', identity_reference = '', updated_at = ? WHERE id = ?`).bind(now, accountId),
      prepareAuditWrite(environment.DB, session.email, "identity.revoked", "user_account", accountId, {
        email: account.email,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
      environment.DB.prepare(`UPDATE premium_bids SET status = 'cancelled_identity', updated_at = ?
        WHERE owner_email = ? AND status IN ('active', 'winner_pending')`).bind(now, account.email),
      environment.DB.prepare(`UPDATE premium_awards SET status = 'identity_revoked', updated_at = ?, confirmed_by = ?
        WHERE owner_email = ? AND status IN ('payment_pending', 'scheduled', 'active')`).bind(now, session.email, account.email),
      environment.DB.prepare(`UPDATE premium_placements SET status = 'identity_revoked', updated_at = ?
        WHERE owner_email = ? AND status IN ('scheduled', 'active')`).bind(now, account.email),
      environment.DB.prepare(`UPDATE directory_servers SET premium_managed = 0, premium_tier = 'none', premium_starts_at = NULL,
        premium_ends_at = NULL, premium_note = '', updated_at = ? WHERE owner_email = ?`).bind(now, account.email),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "계정 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    return Response.json({ status: "revoked" });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
