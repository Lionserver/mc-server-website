import { adminErrorResponse, prepareAuditWrite, requireAdmin } from "@/lib/admin-security";
import { ensurePublicDirectorySchema } from "@/lib/public-directory";
import { synchronizeVoteSourceBlocks } from "@/lib/vote-source";

const MAX_BLOCK_SECONDS = 90 * 86_400;

export async function POST(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true });
    await ensurePublicDirectorySchema(environment.DB);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const voteId = typeof body.voteId === "string" && /^[a-f0-9]{32}$/.test(body.voteId) ? body.voteId : "";
    if (!voteId) throw Response.json({ error: "차단할 추천 기록을 선택해 주세요." }, { status: 400 });
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) {
      throw Response.json({ error: "차단 사유는 3-500자로 입력해 주세요." }, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(body.expiresAt);
    if (!Number.isInteger(expiresAt) || expiresAt <= now || expiresAt > now + MAX_BLOCK_SECONDS) {
      throw Response.json({ error: "차단 기간은 지금부터 최대 90일까지 설정할 수 있습니다." }, { status: 400 });
    }
    await synchronizeVoteSourceBlocks(environment.DB, now);
    const vote = await environment.DB.prepare(`SELECT v.source_ip_hash, v.source_ip_masked, v.source_ip_version,
      v.nickname, v.server_id, d.title server_title
      FROM server_votes v LEFT JOIN directory_servers d ON d.id = v.server_id WHERE v.id = ?`)
      .bind(voteId).first<{ source_ip_hash: string; source_ip_masked: string; source_ip_version: number; nickname: string; server_id: string; server_title: string | null }>();
    if (!vote) return Response.json({ error: "추천 기록을 찾을 수 없습니다." }, { status: 404 });
    if (!vote.source_ip_hash) {
      return Response.json({ error: "IP 대조 정보가 없는 기존 추천 기록은 차단할 수 없습니다." }, { status: 409 });
    }
    const existing = await environment.DB.prepare(`SELECT id FROM vote_source_blocks
      WHERE source_ip_hash = ? AND status = 'active' AND expires_at > ? LIMIT 1`)
      .bind(vote.source_ip_hash, now).first<{ id: string }>();
    if (existing) return Response.json({ error: "이미 추천 차단 중인 접속 환경입니다.", id: existing.id }, { status: 409 });

    const id = crypto.randomUUID().replaceAll("-", "");
    const results = await environment.DB.batch([
      environment.DB.prepare(`INSERT INTO vote_source_blocks
        (id, source_ip_hash, source_ip_masked, source_ip_version, reason, status, expires_at,
          created_by, resolved_by, resolved_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?, ?)`)
        .bind(id, vote.source_ip_hash, vote.source_ip_masked, vote.source_ip_version, reason,
          expiresAt, session.email, now, now),
      prepareAuditWrite(environment.DB, session.email, "vote_source.blocked", "vote_source", id, {
        voteId, serverId: vote.server_id, serverTitle: vote.server_title, nickname: vote.nickname,
        ipMasked: vote.source_ip_masked, reason, expiresAt,
      }, { createdAt: now, onlyIfPreviousStatementChanged: true }),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "추천 차단을 생성하지 못했습니다." }, { status: 409 });
    }
    return Response.json({ block: { id, ipMasked: vote.source_ip_masked, reason, expiresAt, status: "active" } }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
