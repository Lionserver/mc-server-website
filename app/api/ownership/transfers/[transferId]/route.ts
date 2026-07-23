import { directoryErrorResponse, ownerEmailFromRequest } from "@/lib/server-directory";
import { updateOwnershipTransfer } from "@/lib/server-ownership";

type Context = { params: Promise<{ transferId: string }> | { transferId: string } };

export async function PATCH(request: Request, context: Context) {
  try {
    const { transferId } = await context.params;
    return Response.json(await updateOwnershipTransfer(request, await ownerEmailFromRequest(request), transferId, await request.json()));
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
