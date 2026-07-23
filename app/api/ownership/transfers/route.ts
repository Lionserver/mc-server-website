import { directoryErrorResponse, ownerEmailFromRequest } from "@/lib/server-directory";
import { createOwnershipTransfer } from "@/lib/server-ownership";

export async function POST(request: Request) {
  try {
    return Response.json(await createOwnershipTransfer(request, await ownerEmailFromRequest(request), await request.json()), { status: 201 });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
