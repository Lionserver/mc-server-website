import { adminErrorResponse, normalizeBlacklistValue, requireAdmin, writeAudit, type BlacklistKind } from "@/lib/admin-security";

export async function POST(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const body = await request.json() as Record<string, unknown>;
    const kind = body.kind === "ip" || body.kind === "address" ? body.kind : null;
    if (!kind) throw Response.json({ error: "차단 기준은 IP 또는 서버 주소여야 합니다." }, { status: 400 });
    const value = normalizeBlacklistValue(kind as BlacklistKind, body.value);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) throw Response.json({ error: "차단 사유는 3-500자로 입력해 주세요." }, { status: 400 });
    const expiresAt = parseExpiry(body.expiresAt);
    const now = Math.floor(Date.now() / 1000);
    const duplicate = await environment.DB.prepare(`SELECT id FROM server_blacklist
      WHERE kind = ? AND value = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`)
      .bind(kind, value, now).first<{ id: string }>();
    if (duplicate) return Response.json({ error: "이미 활성 차단 목록에 있습니다.", id: duplicate.id }, { status: 409 });
    const id = crypto.randomUUID().replaceAll("-", "");
    const matchSql = kind === "address"
      ? "lower(address) = ?"
      : "instr(lower(resolved_ips), '\"' || ? || '\"') > 0";
    const [, affected] = await environment.DB.batch([
      environment.DB.prepare(`INSERT INTO server_blacklist
        (id, kind, value, reason, status, expires_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
        .bind(id, kind, value, reason, expiresAt, session.email, now, now),
      environment.DB.prepare(`UPDATE directory_servers SET
        status_before_blacklist = CASE WHEN status = 'blacklisted' THEN status_before_blacklist ELSE status END,
        status = 'blacklisted', updated_at = ?
        WHERE ${matchSql} AND deleted_at IS NULL`).bind(now, value),
    ]);
    await writeAudit(environment.DB, session.email, "blacklist.created", "blacklist", id, {
      kind, value, reason, expiresAt, affectedServers: affected.meta.changes ?? 0,
    });
    return Response.json({ entry: { id, kind, value, reason, status: "active", expiresAt, createdBy: session.email, createdAt: now } }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function parseExpiry(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(parsed) || parsed <= now || parsed > 4_102_444_800) throw Response.json({ error: "차단 만료일은 미래 날짜여야 합니다." }, { status: 400 });
  return parsed;
}
