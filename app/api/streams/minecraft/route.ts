import { minecraftStreams } from "@/lib/minecraft-streams";

export async function GET() {
  const payload = await minecraftStreams();
  return Response.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
