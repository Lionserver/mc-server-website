import { getOwnerSession, logoutOwner } from "@/lib/user-auth";

export async function GET(request: Request) {
  const session = await getOwnerSession(request);
  if (!session) return Response.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ authenticated: true, ...session }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  try {
    const cookie = await logoutOwner(request);
    return new Response(null, { status: 204, headers: { "Set-Cookie": cookie } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "로그아웃에 실패했습니다." }, { status: 500 });
  }
}
