import {
  adminErrorResponse, prepareAuditWrite, requireAdmin, synchronizeServerEnforcements,
  type ServerEnforcementKind,
} from "@/lib/admin-security";
import { synchronizePremiumAuctions } from "@/lib/premium-auction";

const enforcementKinds = new Set<ServerEnforcementKind>(["warning", "suspension", "blind"]);

export async function POST(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true, stepUp: true });
    const body = await request.json() as Record<string, unknown>;
    const serverId = typeof body.serverId === "string" ? body.serverId : "";
    const kind = typeof body.kind === "string" && enforcementKinds.has(body.kind as ServerEnforcementKind)
      ? body.kind as ServerEnforcementKind
      : null;
    if (!/^[a-f0-9]{32}$/.test(serverId)) throw Response.json({ error: "제재할 서버를 선택해 주세요." }, { status: 400 });
    if (!kind) throw Response.json({ error: "경고, 임시 차단 또는 블라인드 중 하나를 선택해 주세요." }, { status: 400 });
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) throw Response.json({ error: "제재 사유는 3-500자로 입력해 주세요." }, { status: 400 });
    const expiresAt = parseExpiry(body.expiresAt);
    const server = await environment.DB.prepare("SELECT id, title, owner_email FROM directory_servers WHERE id = ? AND deleted_at IS NULL")
      .bind(serverId).first<{ id: string; title: string; owner_email: string }>();
    if (!server) return Response.json({ error: "서버를 찾을 수 없습니다." }, { status: 404 });
    const now = Math.floor(Date.now() / 1000);
    const duplicate = await environment.DB.prepare(`SELECT id FROM server_enforcements
      WHERE server_id = ? AND kind = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`)
      .bind(serverId, kind, now).first<{ id: string }>();
    if (duplicate) return Response.json({ error: "같은 종류의 활성 제재가 이미 적용되어 있습니다.", id: duplicate.id }, { status: 409 });
    const id = crypto.randomUUID().replaceAll("-", "");
    const results = await environment.DB.batch([
      environment.DB.prepare(`INSERT INTO server_enforcements
        (id, server_id, kind, reason, status, starts_at, expires_at, created_by, resolved_by, resolved_at,
          resolution_note, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, '', ?, ?)`)
        .bind(id, serverId, kind, reason, now, expiresAt, session.email, now, now),
      prepareAuditWrite(environment.DB, session.email, `server.enforcement.${kind}.created`, "server", serverId, {
        enforcementId: id, serverTitle: server.title, ownerEmail: server.owner_email, kind, reason, expiresAt,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "서버 제재를 생성하지 못했습니다." }, { status: 409 });
    }
    await synchronizeServerEnforcements(environment.DB);
    await synchronizePremiumAuctions(environment.DB);
    return Response.json({ enforcement: { id, serverId, serverTitle: server.title, kind, reason, status: "active", startsAt: now, expiresAt } }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function parseExpiry(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(parsed) || parsed <= now || parsed > 4_102_444_800) {
    throw Response.json({ error: "제재 종료일은 현재보다 미래여야 합니다." }, { status: 400 });
  }
  return parsed;
}
