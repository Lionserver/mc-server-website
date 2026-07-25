import {
  adminErrorResponse,
  listAdminSessions,
  revokeAdminSessions,
} from "@/lib/admin-security";

export async function GET(request: Request) {
  try {
    return Response.json({ sessions: await listAdminSessions(request) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const result = await revokeAdminSessions(request, await request.json().catch(() => ({})));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
