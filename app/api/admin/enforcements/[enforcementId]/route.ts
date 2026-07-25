import { adminErrorResponse, prepareAuditWrite, requireAdmin, synchronizeServerEnforcements } from "@/lib/admin-security";
import { synchronizePremiumAuctions } from "@/lib/premium-auction";

type RouteContext = { params: Promise<{ enforcementId: string }> | { enforcementId: string } };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { enforcementId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(enforcementId)) throw Response.json({ error: "유효하지 않은 제재 ID입니다." }, { status: 400 });
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    const existing = await environment.DB.prepare(`SELECT e.id, e.server_id, e.kind, e.reason, e.status, d.title
      FROM server_enforcements e JOIN directory_servers d ON d.id = e.server_id WHERE e.id = ?`)
      .bind(enforcementId).first<{ id: string; server_id: string; kind: string; reason: string; status: string; title: string }>();
    if (!existing) return Response.json({ error: "제재 기록을 찾을 수 없습니다." }, { status: 404 });
    if (existing.status !== "active") return Response.json({ error: "이미 종료된 제재입니다." }, { status: 409 });
    const body = await request.json().catch(() => ({})) as { note?: unknown };
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "총관리자 수동 해제";
    const now = Math.floor(Date.now() / 1000);
    const results = await environment.DB.batch([
      environment.DB.prepare(`UPDATE server_enforcements SET status = 'revoked', resolved_by = ?, resolved_at = ?,
        resolution_note = ?, updated_at = ? WHERE id = ? AND status = 'active'`)
        .bind(session.email, now, note || "총관리자 수동 해제", now, enforcementId),
      prepareAuditWrite(environment.DB, session.email, `server.enforcement.${existing.kind}.revoked`, "server", existing.server_id, {
        enforcementId, serverTitle: existing.title, reason: existing.reason, resolutionNote: note,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "제재 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    await synchronizeServerEnforcements(environment.DB);
    await synchronizePremiumAuctions(environment.DB);
    return new Response(null, { status: 204 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
