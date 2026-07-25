import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import { ensureUserAuthSchema } from "@/lib/user-auth";

type AccountRow = {
  id: string;
  email: string;
  email_verified_at: number;
  last_login_at: number;
  identity_verification_status: string;
  identity_verified_at: number | null;
  identity_provider: string;
  identity_reference_masked: string;
  account_status: string;
  suspended_at: number | null;
  suspended_by: string | null;
  suspension_reason: string;
  created_at: number;
  updated_at: number;
};

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    await ensureUserAuthSchema(environment.DB);
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const accountStatus = normalizedFilter(url.searchParams.get("accountStatus"), "계정 상태");
    const identityStatus = normalizedFilter(url.searchParams.get("identityStatus"), "본인인증 상태");
    const page = boundedInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = boundedInteger(url.searchParams.get("limit"), 50, 10, 100);
    const offset = (page - 1) * pageSize;

    const where: string[] = ["1 = 1"];
    const bindings: Array<string | number> = [];
    if (accountStatus) {
      where.push("a.account_status = ?");
      bindings.push(accountStatus);
    }
    if (identityStatus) {
      where.push("a.identity_verification_status = ?");
      bindings.push(identityStatus);
    }
    if (query) {
      where.push(`(instr(lower(a.id), lower(?)) > 0
        OR instr(lower(a.email), lower(?)) > 0
        OR instr(lower(a.identity_provider), lower(?)) > 0
        OR instr(lower(a.suspended_by), lower(?)) > 0
        OR instr(lower(a.suspension_reason), lower(?)) > 0)`);
      bindings.push(query, query, query, query, query);
    }
    const whereSql = where.join(" AND ");

    const [rows, count] = await Promise.all([
      environment.DB.prepare(`SELECT a.id, a.email, a.email_verified_at, a.last_login_at,
        a.identity_verification_status, a.identity_verified_at, a.identity_provider,
        CASE
          WHEN a.identity_reference = '' THEN ''
          WHEN length(a.identity_reference) <= 4 THEN '••••'
          ELSE '••••' || substr(a.identity_reference, -4)
        END identity_reference_masked,
        a.account_status, a.suspended_at, a.suspended_by, a.suspension_reason, a.created_at, a.updated_at
        FROM user_accounts a WHERE ${whereSql}
        ORDER BY a.updated_at DESC, a.id ASC LIMIT ? OFFSET ?`)
        .bind(...bindings, pageSize, offset).all<AccountRow>(),
      environment.DB.prepare(`SELECT COUNT(*) count FROM user_accounts a WHERE ${whereSql}`)
        .bind(...bindings).first<{ count: number }>(),
    ]);

    const total = Number(count?.count ?? 0);
    return Response.json({
      items: rows.results.map((row) => ({
        id: row.id,
        email: row.email,
        emailVerifiedAt: row.email_verified_at,
        lastLoginAt: row.last_login_at,
        identityVerificationStatus: row.identity_verification_status,
        identityVerifiedAt: row.identity_verified_at,
        identityProvider: row.identity_provider,
        identityReferenceMasked: row.identity_reference_masked,
        accountStatus: row.account_status,
        suspendedAt: row.suspended_at,
        suspendedBy: row.suspended_by,
        suspensionReason: row.suspension_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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

function normalizedFilter(value: string | null, label: string) {
  const filter = (value ?? "").trim().toLowerCase();
  if (!filter || filter === "all") return "";
  if (!/^[a-z][a-z_]{0,39}$/.test(filter)) {
    throw Response.json({ error: `${label} 필터가 올바르지 않습니다.` }, { status: 400 });
  }
  return filter;
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
