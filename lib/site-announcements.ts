import { nextAnnouncementTransition } from "@/lib/site-announcement-lifecycle.mjs";

export type AnnouncementPublicationStatus = "draft" | "published" | "archived";

export type SiteAnnouncement = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  status: AnnouncementPublicationStatus;
  startsAt: number;
  endsAt: number;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  deletedBy: string | null;
};

type AnnouncementRow = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  publication_status: AnnouncementPublicationStatus;
  starts_at: number;
  ends_at: number;
  revision: number;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  deleted_by: string | null;
};

const MAX_TIMESTAMP = 4_102_444_800;
const MAX_ANNOUNCEMENT_SECONDS = 366 * 86_400;
const INVALID_TEXT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const schemaReadyByDatabase = new WeakMap<object, Promise<void>>();

export async function ensureSiteAnnouncementSchema(db: D1Database) {
  const key = db as unknown as object;
  const existing = schemaReadyByDatabase.get(key);
  if (existing) return existing;
  const ready = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS site_announcements (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      publication_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (publication_status IN ('draft', 'published', 'archived')),
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      deleted_by TEXT,
      CHECK (ends_at > starts_at)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS site_announcements_window_idx
      ON site_announcements (publication_status, deleted_at, starts_at, ends_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS site_announcements_admin_idx
      ON site_announcements (deleted_at, updated_at, id)`),
  ]).then(() => undefined);
  schemaReadyByDatabase.set(key, ready);
  try {
    await ready;
  } catch (error) {
    schemaReadyByDatabase.delete(key);
    throw error;
  }
}

export async function listSiteAnnouncements(db: D1Database, limit = 200) {
  await ensureSiteAnnouncementSchema(db);
  const safeLimit = Number.isInteger(limit) ? Math.min(500, Math.max(1, limit)) : 200;
  const rows = await db.prepare(`SELECT id, title, summary, detail, publication_status, starts_at, ends_at,
    revision, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by
    FROM site_announcements
    ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, starts_at DESC, created_at DESC, id ASC
    LIMIT ?`).bind(safeLimit).all<AnnouncementRow>();
  return rows.results.map(siteAnnouncementFromRow);
}

export async function getSiteAnnouncement(db: D1Database, id: string) {
  await ensureSiteAnnouncementSchema(db);
  const row = await db.prepare(`SELECT id, title, summary, detail, publication_status, starts_at, ends_at,
    revision, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by
    FROM site_announcements WHERE id = ? LIMIT 1`).bind(id).first<AnnouncementRow>();
  return row ? siteAnnouncementFromRow(row) : null;
}

export async function overlappingPublishedAnnouncement(
  db: D1Database,
  startsAt: number,
  endsAt: number,
  excludeId?: string,
) {
  await ensureSiteAnnouncementSchema(db);
  const row = excludeId
    ? await db.prepare(`SELECT id FROM site_announcements
        WHERE publication_status = 'published' AND deleted_at IS NULL AND id <> ?
          AND starts_at < ? AND ends_at > ?
        ORDER BY starts_at DESC, created_at DESC, id ASC LIMIT 1`)
        .bind(excludeId, endsAt, startsAt).first<{ id: string }>()
    : await db.prepare(`SELECT id FROM site_announcements
        WHERE publication_status = 'published' AND deleted_at IS NULL
          AND starts_at < ? AND ends_at > ?
        ORDER BY starts_at DESC, created_at DESC, id ASC LIMIT 1`)
        .bind(endsAt, startsAt).first<{ id: string }>();
  return row?.id ?? null;
}

export async function publicAnnouncementState(db: D1Database, now = Math.floor(Date.now() / 1000)) {
  await ensureSiteAnnouncementSchema(db);
  const [activeRows, nextRow] = await Promise.all([
    db.prepare(`SELECT id, title, summary, detail, publication_status, starts_at, ends_at,
      revision, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by
      FROM site_announcements
      WHERE publication_status = 'published' AND deleted_at IS NULL
        AND starts_at <= ? AND ends_at > ?
      ORDER BY starts_at DESC, created_at DESC, id ASC
      LIMIT 20`).bind(now, now).all<AnnouncementRow>(),
    db.prepare(`SELECT MIN(starts_at) AS next_start_at
      FROM site_announcements
      WHERE publication_status = 'published' AND deleted_at IS NULL AND starts_at > ?`)
      .bind(now).first<{ next_start_at: number | null }>(),
  ]);
  const announcements = activeRows.results.map(siteAnnouncementFromRow);
  return {
    announcements: announcements.map(publicSiteAnnouncement),
    nextTransitionAt: nextAnnouncementTransition(announcements, nextRow?.next_start_at ?? null, now),
    serverTime: now,
  };
}

export function parseSiteAnnouncementInput(body: Record<string, unknown>, now: number): {
  title: string;
  summary: string;
  detail: string;
  status: "draft" | "published";
  startsAt: number;
  endsAt: number;
} {
  const status = body.status === "draft" ? "draft" : body.status === "published" ? "published" : null;
  if (!status) throw Response.json({ error: "공지 상태는 임시저장 또는 게시 중 하나여야 합니다." }, { status: 400 });
  const title = normalizedText(body.title, "공지 제목", 1, 120, false);
  const summary = normalizedText(body.summary, "공지 요약", 1, 300, false);
  const detail = normalizedText(body.detail, "공지 상세내용", 1, 5_000, true);
  const startsAt = timestamp(body.startsAt, "공지 시작일");
  const endsAt = timestamp(body.endsAt, "공지 종료일");
  if (startsAt >= endsAt) throw Response.json({ error: "공지 종료일은 시작일보다 뒤여야 합니다." }, { status: 400 });
  if (endsAt <= now) throw Response.json({ error: "공지 종료일은 현재보다 미래여야 합니다." }, { status: 400 });
  if (endsAt - startsAt > MAX_ANNOUNCEMENT_SECONDS) {
    throw Response.json({ error: "공지 기간은 최대 366일까지 설정할 수 있습니다." }, { status: 400 });
  }
  return { title, summary, detail, status, startsAt, endsAt };
}

export function expectedAnnouncementRevision(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw Response.json({ error: "공지 수정 버전을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요." }, { status: 400 });
  }
  return Number(value);
}

export async function announcementAuditSummary(
  value: Pick<SiteAnnouncement, "title" | "summary" | "status" | "startsAt" | "endsAt" | "detail">,
) {
  const [summaryDigest, detailDigest] = await Promise.all([
    sha256(value.summary),
    sha256(value.detail),
  ]);
  return {
    title: value.title,
    status: value.status,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    summaryLength: value.summary.length,
    summarySha256: summaryDigest,
    detailLength: value.detail.length,
    detailSha256: detailDigest,
  };
}

function normalizedText(value: unknown, label: string, min: number, max: number, multiline: boolean) {
  if (typeof value !== "string") throw Response.json({ error: `${label}을 입력해 주세요.` }, { status: 400 });
  const lineNormalized = value.replace(/\r\n?/g, "\n");
  if (INVALID_TEXT_CONTROL.test(lineNormalized)) {
    throw Response.json({ error: `${label}에 사용할 수 없는 제어문자가 포함되어 있습니다.` }, { status: 400 });
  }
  const normalized = multiline ? lineNormalized.trim() : lineNormalized.replace(/\s+/g, " ").trim();
  if (normalized.length < min || normalized.length > max) {
    throw Response.json({ error: `${label}은 ${min.toLocaleString()}-${max.toLocaleString()}자로 입력해 주세요.` }, { status: 400 });
  }
  return normalized;
}

function timestamp(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1_577_836_800 || Number(value) > MAX_TIMESTAMP) {
    throw Response.json({ error: `${label}을 올바르게 입력해 주세요.` }, { status: 400 });
  }
  return Number(value);
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function siteAnnouncementFromRow(row: AnnouncementRow): SiteAnnouncement {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    detail: row.detail,
    status: row.publication_status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    revision: row.revision,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
  };
}

function publicSiteAnnouncement(announcement: SiteAnnouncement) {
  return {
    id: announcement.id,
    title: announcement.title,
    summary: announcement.summary,
    detail: announcement.detail,
    startsAt: announcement.startsAt,
    endsAt: announcement.endsAt,
    updatedAt: announcement.updatedAt,
  };
}
