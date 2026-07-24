import { directoryEnv } from "@/lib/server-directory";

export async function GET() {
  const environment = await directoryEnv() as {
    CHAT_ROOMS?: DurableObjectNamespace;
    DIRECTORY_LIVE?: DurableObjectNamespace;
  };
  return Response.json({
    directory: Boolean(environment.DIRECTORY_LIVE),
    chat: Boolean(environment.CHAT_ROOMS),
    fallback: "polling",
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
