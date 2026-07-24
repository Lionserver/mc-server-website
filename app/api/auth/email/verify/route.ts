import { verifyEmailCode } from "@/lib/user-auth";

export async function POST(request: Request) {
  try {
    const result = await verifyEmailCode(request, await request.json());
    return Response.json({ authenticated: true, ...result.session }, {
      headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("email-code verification failed", error);
    return Response.json({
      error: process.env.NODE_ENV === "production"
        ? "인증을 처리하지 못했습니다."
        : error instanceof Error ? error.message : "인증에 실패했습니다.",
    }, { status: 500 });
  }
}
