import { directoryErrorResponse, ownerEmailFromRequest } from "@/lib/server-directory";
import { createOwnershipClaim } from "@/lib/server-ownership";

export async function POST(request: Request) {
  try {
    return Response.json(await createOwnershipClaim(request, await ownerEmailFromRequest(request), await request.json()), { status: 201 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
