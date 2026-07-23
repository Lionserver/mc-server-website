import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import {
  adminAuctionDashboard, cancelPremiumAuction, confirmPremiumAward, ensurePremiumAuctionSchema,
  cancelManualPremiumPlacement, fillCurrentPremiumVacancy, finalizePremiumAuction, forfeitPremiumAward, updatePremiumAuctionRules,
} from "@/lib/premium-auction";

type RouteContext = { params: Promise<{ auctionId: string }> | { auctionId: string } };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { auctionId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(auctionId)) throw Response.json({ error: "유효하지 않은 경매 ID입니다." }, { status: 400 });
    const { environment, session } = await requireAdmin(request, { mutating: true });
    await ensurePremiumAuctionSchema(environment.DB);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "update_rules") {
      await updatePremiumAuctionRules(environment.DB, auctionId, session.email, body);
    } else if (action === "finalize_now") {
      requireConfirmation(body, auctionId);
      const finalized = await finalizePremiumAuction(environment.DB, auctionId, session.email, true);
      if (!finalized) throw Response.json({ error: "이미 마감되었거나 마감할 수 없는 경매입니다." }, { status: 409 });
    } else if (action === "cancel") {
      requireConfirmation(body, auctionId);
      await cancelPremiumAuction(environment.DB, auctionId, session.email);
    } else if (action === "confirm_payment") {
      const awardId = validId(body.awardId, "낙찰 ID");
      const suppliedReference = typeof body.paymentReference === "string" ? body.paymentReference.trim().slice(0, 120) : "";
      const paymentReference = suppliedReference || `admin-confirmation:${session.email}:${Date.now()}`;
      await confirmPremiumAward(environment.DB, auctionId, awardId, session.email, paymentReference);
    } else if (action === "forfeit") {
      const awardId = validId(body.awardId, "낙찰 ID");
      await forfeitPremiumAward(environment.DB, auctionId, awardId, session.email);
    } else if (action === "fill_current_slot") {
      const serverId = validId(body.serverId, "서버 ID");
      await fillCurrentPremiumVacancy(environment.DB, serverId, session.email, body.note);
    } else if (action === "cancel_manual_placement") {
      const placementId = validId(body.placementId, "광고 배치 ID");
      await cancelManualPremiumPlacement(environment.DB, placementId, session.email);
    } else {
      throw Response.json({ error: "지원하지 않는 경매 작업입니다." }, { status: 400 });
    }
    return Response.json(await adminAuctionDashboard(environment.DB), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function requireConfirmation(body: Record<string, unknown>, auctionId: string) {
  if (body.confirmation !== auctionId) throw Response.json({ error: "경매 ID 확인값이 일치하지 않습니다." }, { status: 400 });
}

function validId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) throw Response.json({ error: `${label}가 올바르지 않습니다.` }, { status: 400 });
  return value;
}
