import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import {
  AUDIT_CSV_BATCH_ROWS,
  AUDIT_CSV_MAX_ROWS,
  auditCsvDocumentStart,
  auditRowsToCsvChunk,
} from "@/lib/admin-audit-csv.mjs";

type AuditRow = {
  id: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: number;
};

type AuditFilters = {
  query: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  from: number | null;
  to: number | null;
};

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "").trim().toLowerCase();
    if (format && format !== "json" && format !== "csv") {
      throw Response.json({ error: "지원하지 않는 감사 로그 형식입니다." }, { status: 400 });
    }

    const filters = auditFiltersFrom(url);
    const { whereSql, bindings } = auditWhere(filters);
    if (format === "csv") {
      const count = await environment.DB.prepare(`SELECT COUNT(*) count FROM admin_audit_logs WHERE ${whereSql}`)
        .bind(...bindings).first<{ count: number }>();
      const total = Number(count?.count ?? 0);
      const truncated = total > AUDIT_CSV_MAX_ROWS;
      const encoder = new TextEncoder();
      let emitted = 0;
      let cursorCreatedAt: number | null = null;
      let cursorId = "";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(auditCsvDocumentStart()));
        },
        async pull(controller) {
          if (emitted >= Math.min(total, AUDIT_CSV_MAX_ROWS)) {
            controller.close();
            return;
          }
          const batchSize = Math.min(AUDIT_CSV_BATCH_ROWS, AUDIT_CSV_MAX_ROWS - emitted);
          const cursorSql = cursorCreatedAt == null
            ? ""
            : " AND (created_at < ? OR (created_at = ? AND id < ?))";
          const cursorBindings = cursorCreatedAt == null
            ? []
            : [cursorCreatedAt, cursorCreatedAt, cursorId];
          try {
            const result = await environment.DB.prepare(`SELECT id, admin_email, action, target_type, target_id, details, created_at
              FROM admin_audit_logs WHERE ${whereSql}${cursorSql}
              ORDER BY created_at DESC, id DESC LIMIT ?`)
              .bind(...bindings, ...cursorBindings, batchSize).all<AuditRow>();
            if (result.results.length === 0) {
              controller.close();
              return;
            }
            const last = result.results.at(-1) as AuditRow;
            cursorCreatedAt = last.created_at;
            cursorId = last.id;
            emitted += result.results.length;
            controller.enqueue(encoder.encode(auditRowsToCsvChunk(result.results)));
            if (result.results.length < batchSize || emitted >= AUDIT_CSV_MAX_ROWS) controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      const kstDay = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
      return new Response(stream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="admin-audits-${kstDay}.csv"`,
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
          "X-Content-Type-Options": "nosniff",
          "X-Export-Limit": String(AUDIT_CSV_MAX_ROWS),
          "X-Export-Truncated": String(truncated),
          "X-Export-Total": String(total),
        },
      });
    }

    const page = boundedInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = boundedInteger(url.searchParams.get("limit"), 50, 10, 100);
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([
      environment.DB.prepare(`SELECT id, admin_email, action, target_type, target_id, details, created_at
        FROM admin_audit_logs WHERE ${whereSql}
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .bind(...bindings, pageSize, offset).all<AuditRow>(),
      environment.DB.prepare(`SELECT COUNT(*) count FROM admin_audit_logs WHERE ${whereSql}`)
        .bind(...bindings).first<{ count: number }>(),
    ]);

    const total = Number(count?.count ?? 0);
    return Response.json({
      items: rows.results.map((row) => ({
        id: row.id,
        adminEmail: row.admin_email,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: parseDetails(row.details),
        createdAt: row.created_at,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function auditFiltersFrom(url: URL): AuditFilters {
  const from = timestampFilter(url.searchParams.get("from"), "시작일", "start");
  const to = timestampFilter(url.searchParams.get("to"), "종료일", "end");
  if (from != null && to != null && from > to) {
    throw Response.json({ error: "종료일은 시작일 이후여야 합니다." }, { status: 400 });
  }
  return {
    query: (url.searchParams.get("q") ?? "").trim().slice(0, 100),
    adminEmail: (url.searchParams.get("adminEmail") ?? url.searchParams.get("admin") ?? "").trim().slice(0, 254),
    action: (url.searchParams.get("action") ?? "").trim().slice(0, 80),
    targetType: (url.searchParams.get("targetType") ?? "").trim().slice(0, 40),
    targetId: (url.searchParams.get("targetId") ?? "").trim().slice(0, 160),
    from,
    to,
  };
}

function auditWhere(filters: AuditFilters) {
  const where: string[] = ["1 = 1"];
  const bindings: Array<string | number> = [];
  if (filters.adminEmail) {
    where.push("lower(admin_email) = lower(?)");
    bindings.push(filters.adminEmail);
  }
  if (filters.action) {
    where.push("action = ?");
    bindings.push(filters.action);
  }
  if (filters.targetType) {
    where.push("target_type = ?");
    bindings.push(filters.targetType);
  }
  if (filters.targetId) {
    where.push("target_id = ?");
    bindings.push(filters.targetId);
  }
  if (filters.from != null) {
    where.push("created_at >= ?");
    bindings.push(filters.from);
  }
  if (filters.to != null) {
    where.push("created_at <= ?");
    bindings.push(filters.to);
  }
  if (filters.query) {
    where.push(`(instr(lower(admin_email), lower(?)) > 0
      OR instr(lower(action), lower(?)) > 0
      OR instr(lower(target_type), lower(?)) > 0
      OR instr(lower(target_id), lower(?)) > 0
      OR instr(lower(details), lower(?)) > 0)`);
    bindings.push(filters.query, filters.query, filters.query, filters.query, filters.query);
  }
  return { whereSql: where.join(" AND "), bindings };
}

function timestampFilter(value: string | null, label: string, boundary: "start" | "end") {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^\d{1,13}$/.test(raw)) {
    const numeric = Number(raw);
    const seconds = numeric >= 1_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
    if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 4_102_444_800) return seconds;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const milliseconds = dateOnly
    ? Date.parse(`${raw}T00:00:00+09:00`) + (boundary === "end" ? 86_399_000 : 0)
    : Date.parse(raw);
  if (!Number.isNaN(milliseconds)) {
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds >= 0 && seconds <= 4_102_444_800) return seconds;
  }
  throw Response.json({ error: `${label} 값이 올바르지 않습니다.` }, { status: 400 });
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function parseDetails(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}
