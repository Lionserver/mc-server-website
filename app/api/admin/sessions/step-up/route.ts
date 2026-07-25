import { adminErrorResponse, stepUpAdmin } from "@/lib/admin-security";

export async function POST(request: Request) {
  try {
    const result = await stepUpAdmin(request, await request.json().catch(() => ({})));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
