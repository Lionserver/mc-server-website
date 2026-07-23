import { requestEmailCode } from "@/lib/user-auth";

export async function POST(request: Request) {
  try {
    const result = await requestEmailCode(request, await request.json());
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authError(error);
  }
}

function authError(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({ error: error instanceof Error ? error.message : "인증 요청에 실패했습니다." }, { status: 500 });
}
