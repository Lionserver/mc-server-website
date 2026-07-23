import { directoryEnv, directoryErrorResponse, ownerEmailFromRequest } from "@/lib/server-directory";
import { ownershipSummary } from "@/lib/server-ownership";

export async function GET(request: Request) {
  try {
    const ownerEmail = await ownerEmailFromRequest(request);
    const environment = await directoryEnv();
    return Response.json(await ownershipSummary(environment.DB, ownerEmail), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return directoryErrorResponse(error);
  }
}
