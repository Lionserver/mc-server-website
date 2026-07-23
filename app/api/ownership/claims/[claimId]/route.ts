import { directoryErrorResponse, ownerEmailFromRequest } from "@/lib/server-directory";
import { updateOwnershipClaim } from "@/lib/server-ownership";

type Context = { params: Promise<{ claimId: string }> | { claimId: string } };

export async function PATCH(request: Request, context: Context) {
  try {
    const { claimId } = await context.params;
    return Response.json(await updateOwnershipClaim(request, await ownerEmailFromRequest(request), claimId, await request.json()));
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
