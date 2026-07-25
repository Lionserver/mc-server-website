import { adminErrorResponse, prepareAuditWrite, requireAdmin } from "@/lib/admin-security";

type RouteContext = { params: Promise<{ blockId: string }> | { blockId: string } };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { blockId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(blockId)) {
      throw Response.json({ error: "유효하지 않은 추천 차단 ID입니다." }, { status: 400 });
    }
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const existing = await environment.DB.prepare(`SELECT id, source_ip_masked, reason, status, expires_at
      FROM vote_source_blocks WHERE id = ?`).bind(blockId)
      .first<{ id: string; source_ip_masked: string; reason: string; status: string; expires_at: number }>();
    if (!existing) return Response.json({ error: "추천 차단 기록을 찾을 수 없습니다." }, { status: 404 });
    if (existing.status !== "active") return Response.json({ error: "이미 종료된 추천 차단입니다." }, { status: 409 });
    const now = Math.floor(Date.now() / 1000);
    const results = await environment.DB.batch([
      environment.DB.prepare(`UPDATE vote_source_blocks SET status = 'revoked', resolved_by = ?, resolved_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active'`).bind(session.email, now, now, blockId),
      prepareAuditWrite(environment.DB, session.email, "vote_source.unblocked", "vote_source", blockId, {
        ipMasked: existing.source_ip_masked, reason: existing.reason, scheduledExpiry: existing.expires_at,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "추천 차단 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
