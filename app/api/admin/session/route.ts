import { adminErrorResponse, loginAdmin, logoutAdmin, requireAdmin, writeAudit } from "@/lib/admin-security";

export async function GET(request: Request) {
  try {
    const { environment, session, tokenHash, temporary } = await requireAdmin(request);
    if (temporary) {
      const auditTarget = tokenHash.slice(0, 12);
      const recorded = await environment.DB.prepare(`SELECT 1 FROM admin_audit_logs
        WHERE action = 'admin.temporary_access.started' AND target_id = ? LIMIT 1`).bind(auditTarget).first();
      if (!recorded) {
        await writeAudit(environment.DB, session.email, "admin.temporary_access.started", "session", auditTarget, {
          expiresAt: session.expiresAt,
          authMode: session.authMode,
        });
      }
    }
    return Response.json(
      { authenticated: true, email: session.email, expiresAt: session.expiresAt, authMode: session.authMode },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await loginAdmin(request, await request.json());
    return Response.json(
      { authenticated: true, email: result.email, expiresAt: result.expiresAt, authMode: "session" },
      { headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const cookie = await logoutAdmin(request);
    return new Response(null, { status: 204, headers: { "Set-Cookie": cookie } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
