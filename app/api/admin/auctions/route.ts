import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import { adminAuctionDashboard, ensurePremiumAuctionSchema } from "@/lib/premium-auction";

export async function GET(request: Request) {
  try {
    const { environment } = await requireAdmin(request);
    await ensurePremiumAuctionSchema(environment.DB);
    return Response.json(await adminAuctionDashboard(environment.DB), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
