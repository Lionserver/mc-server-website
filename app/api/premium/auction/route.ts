import { adminErrorResponse } from "@/lib/admin-security";
import { directoryEnv, ownerEmailFromRequest } from "@/lib/server-directory";
import { ensurePremiumAuctionSchema, ownerAuctionDashboard, placePremiumBid } from "@/lib/premium-auction";

export async function GET(request: Request) {
  try {
    const ownerEmail = await ownerEmailFromRequest(request);
    const serverId = new URL(request.url).searchParams.get("serverId") ?? "";
    if (!/^[a-f0-9]{32}$/.test(serverId)) return Response.json({ error: "유효한 서버를 선택해 주세요." }, { status: 400 });
    const environment = await directoryEnv();
    await ensurePremiumAuctionSchema(environment.DB);
    return Response.json(await ownerAuctionDashboard(environment.DB, ownerEmail, serverId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    await ensurePremiumAuctionSchema(environment.DB);
    const result = await placePremiumBid(environment.DB, request, ownerEmail, await request.json());
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
