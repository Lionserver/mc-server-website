import { directoryEnv, directoryErrorResponse } from "@/lib/server-directory";
import { MinecraftProfileLookupError, resolveMinecraftProfile } from "@/lib/minecraft-profile";
import { assertPublicProfileRateLimit } from "@/lib/request-guards";

export async function GET(request: Request) {
  try {
    const nickname = new URL(request.url).searchParams.get("nickname")?.trim() ?? "";
    const environment = await directoryEnv();
    await assertPublicProfileRateLimit(environment.DB, request);
    const profile = await resolveMinecraftProfile(environment.DB, nickname);
    return Response.json({ profile }, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    if (error instanceof MinecraftProfileLookupError) {
      const status = error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 503;
      return Response.json({ error: error.message }, { status, headers: { "Cache-Control": error.code === "not_found" ? "public, max-age=900" : "no-store" } });
    }
    return directoryErrorResponse(error);
  }
}
