import { adminErrorResponse, requireAdmin, synchronizeBlacklist, synchronizeServerEnforcements, writeAudit } from "@/lib/admin-security";

type RouteContext = { params: Promise<{ entryId: string }> | { entryId: string } };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { entryId } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(entryId)) throw Response.json({ error: "유효하지 않은 차단 ID입니다." }, { status: 400 });
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const existing = await environment.DB.prepare("SELECT id, kind, value, status FROM server_blacklist WHERE id = ?")
      .bind(entryId).first<{ id: string; kind: string; value: string; status: string }>();
    if (!existing) return Response.json({ error: "차단 항목을 찾을 수 없습니다." }, { status: 404 });
    if (existing.status !== "active") return Response.json({ error: "이미 해제된 항목입니다." }, { status: 409 });
    const now = Math.floor(Date.now() / 1000);
    await environment.DB.prepare("UPDATE server_blacklist SET status = 'revoked', updated_at = ? WHERE id = ?")
      .bind(now, entryId).run();
    const before = await environment.DB.prepare("SELECT COUNT(*) count FROM directory_servers WHERE status = 'blacklisted'").first<{ count: number }>();
    await synchronizeBlacklist(environment.DB);
    await synchronizeServerEnforcements(environment.DB);
    const after = await environment.DB.prepare("SELECT COUNT(*) count FROM directory_servers WHERE status = 'blacklisted'").first<{ count: number }>();
    await writeAudit(environment.DB, session.email, "blacklist.revoked", "blacklist", entryId, {
      kind: existing.kind, value: existing.value, restoredServers: Math.max(0, Number(before?.count ?? 0) - Number(after?.count ?? 0)),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
