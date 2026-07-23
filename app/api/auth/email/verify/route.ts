import { verifyEmailCode } from "@/lib/user-auth";

export async function POST(request: Request) {
  try {
    const result = await verifyEmailCode(request, await request.json());
    return Response.json({ authenticated: true, ...result.session }, {
      headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "인증에 실패했습니다." }, { status: 500 });
  }
}
