import { adminErrorResponse, prepareAuditWrite, requireAdmin } from "@/lib/admin-security";
import {
  announcementAuditSummary,
  expectedAnnouncementRevision,
  getSiteAnnouncement,
  invalidatePublicAnnouncementState,
  overlappingPublishedAnnouncement,
  parseSiteAnnouncementInput,
} from "@/lib/site-announcements";

export async function PATCH(request: Request, context: { params: Promise<{ announcementId: string }> }) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const { announcementId } = await context.params;
    assertAnnouncementId(announcementId);
    const body = await request.json() as Record<string, unknown>;
    const expectedRevision = expectedAnnouncementRevision(body.revision);
    const now = Math.floor(Date.now() / 1000);
    const input = parseSiteAnnouncementInput(body, now);
    const current = await getSiteAnnouncement(environment.DB, announcementId);
    if (!current || current.deletedAt != null) return Response.json({ error: "공지사항을 찾을 수 없습니다." }, { status: 404 });
    if (current.revision !== expectedRevision) {
      return Response.json({ error: "다른 관리자 작업으로 공지가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    const announcement = {
      ...current,
      ...input,
      revision: expectedRevision + 1,
      updatedBy: session.email,
      updatedAt: now,
    };
    const action = current.status !== "published" && announcement.status === "published"
      ? "announcement.published"
      : "announcement.updated";
    const auditDetails = {
      before: await announcementAuditSummary(current),
      after: await announcementAuditSummary(announcement),
      revision: announcement.revision,
    };
    const [result] = await environment.DB.batch([
      environment.DB.prepare(`UPDATE site_announcements SET
      title = ?, summary = ?, detail = ?, publication_status = ?, starts_at = ?, ends_at = ?,
      revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND revision = ? AND deleted_at IS NULL
        AND (? <> 'published' OR NOT EXISTS (
          SELECT 1 FROM site_announcements other
          WHERE other.publication_status = 'published' AND other.deleted_at IS NULL
            AND other.id <> ? AND other.starts_at < ? AND other.ends_at > ?
        ))`)
      .bind(input.title, input.summary, input.detail, input.status, input.startsAt, input.endsAt,
        session.email, now, announcementId, expectedRevision,
        input.status, announcementId, input.endsAt, input.startsAt),
      prepareAuditWrite(environment.DB, session.email, action, "announcement", announcementId, auditDetails, {
        createdAt: now,
        onlyIfPreviousStatementChanged: true,
      }),
    ]);
    if ((result.meta.changes ?? 0) !== 1) {
      if (input.status === "published" && await overlappingPublishedAnnouncement(
        environment.DB, input.startsAt, input.endsAt, announcementId,
      )) {
        return Response.json({ error: "같은 기간에 게시되는 공지가 이미 있습니다. 기간을 조정해 주세요." }, { status: 409 });
      }
      return Response.json({ error: "다른 관리자 작업으로 공지가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    invalidatePublicAnnouncementState(environment.DB);
    return Response.json({ announcement }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ announcementId: string }> }) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const { announcementId } = await context.params;
    assertAnnouncementId(announcementId);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const expectedRevision = expectedAnnouncementRevision(body.revision);
    const current = await getSiteAnnouncement(environment.DB, announcementId);
    if (!current || current.deletedAt != null) return Response.json({ error: "공지사항을 찾을 수 없습니다." }, { status: 404 });
    if (current.revision !== expectedRevision) {
      return Response.json({ error: "다른 관리자 작업으로 공지가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    const now = Math.floor(Date.now() / 1000);
    const auditDetails = {
      before: await announcementAuditSummary(current),
      revision: expectedRevision + 1,
    };
    const [result] = await environment.DB.batch([
      environment.DB.prepare(`UPDATE site_announcements SET
      publication_status = 'archived', revision = revision + 1, updated_by = ?, updated_at = ?,
      deleted_at = ?, deleted_by = ?
      WHERE id = ? AND revision = ? AND deleted_at IS NULL`)
      .bind(session.email, now, now, session.email, announcementId, expectedRevision),
      prepareAuditWrite(environment.DB, session.email, "announcement.deleted", "announcement", announcementId, auditDetails, {
        createdAt: now,
        onlyIfPreviousStatementChanged: true,
      }),
    ]);
    if ((result.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "다른 관리자 작업으로 공지가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    invalidatePublicAnnouncementState(environment.DB);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function assertAnnouncementId(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw Response.json({ error: "공지사항 식별자가 올바르지 않습니다." }, { status: 400 });
}
