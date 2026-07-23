import { adminErrorResponse, prepareAuditWrite, requireAdmin } from "@/lib/admin-security";
import {
  announcementAuditSummary,
  listSiteAnnouncements,
  parseSiteAnnouncementInput,
} from "@/lib/site-announcements";

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    return Response.json({ announcements: await listSiteAnnouncements(environment.DB) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { environment, session } = await requireAdmin(request, { mutating: true });
    const now = Math.floor(Date.now() / 1000);
    const input = parseSiteAnnouncementInput(await request.json() as Record<string, unknown>, now);
    const id = crypto.randomUUID().replaceAll("-", "");
    const announcement = {
      id,
      ...input,
      revision: 1,
      createdBy: session.email,
      updatedBy: session.email,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
    };
    const auditDetails = {
      after: await announcementAuditSummary(announcement),
      revision: announcement.revision,
    };
    const [insert] = await environment.DB.batch([
      environment.DB.prepare(`INSERT INTO site_announcements
      (id, title, summary, detail, publication_status, starts_at, ends_at, revision,
        created_by, updated_by, created_at, updated_at, deleted_at, deleted_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, NULL
      WHERE ? <> 'published' OR NOT EXISTS (
        SELECT 1 FROM site_announcements
        WHERE publication_status = 'published' AND deleted_at IS NULL
          AND starts_at < ? AND ends_at > ?
      )`)
      .bind(id, input.title, input.summary, input.detail, input.status, input.startsAt, input.endsAt,
        session.email, session.email, now, now, input.status, input.endsAt, input.startsAt),
      prepareAuditWrite(environment.DB, session.email, "announcement.created", "announcement", id, auditDetails, {
        createdAt: now,
        onlyIfPreviousStatementChanged: true,
      }),
    ]);
    if ((insert.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "같은 기간에 게시되는 공지가 이미 있습니다. 기간을 조정해 주세요." }, { status: 409 });
    }
    return Response.json({ announcement }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
