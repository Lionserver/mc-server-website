import { adminErrorResponse, loginAdmin, logoutAdmin, requireAdmin } from "@/lib/admin-security";

export async function GET(request: Request) {
  try {
    const { session } = await requireAdmin(request);
    return Response.json({ authenticated: true, email: session.email, expiresAt: session.expiresAt });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await loginAdmin(request, await request.json());
    return Response.json(
      { authenticated: true, email: result.email, expiresAt: result.expiresAt },
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
