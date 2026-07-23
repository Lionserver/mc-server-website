import { minecraftStreamerProfile } from "@/lib/minecraft-stream-preview";

type RouteContext = { params: Promise<{ streamId: string }> | { streamId: string } };

export async function GET(request: Request, context: RouteContext) {
  const { streamId } = await context.params;
  return minecraftStreamerProfile(request, streamId);
}
