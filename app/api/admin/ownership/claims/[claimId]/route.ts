import { adminErrorResponse, requireAdmin } from "@/lib/admin-security";
import { reviewOwnershipClaim } from "@/lib/server-ownership";

type Context = { params: Promise<{ claimId: string }> | { claimId: string } };

export async function PATCH(request: Request, context: Context) {
  try {
    const { claimId } = await context.params;
    const { session } = await requireAdmin(request, { mutating: true });
    return Response.json(await reviewOwnershipClaim(request, session.email, claimId, await request.json()));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
