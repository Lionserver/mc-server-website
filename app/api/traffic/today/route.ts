import { directoryEnv } from "@/lib/server-directory";
import { recordTodayVisitor } from "@/lib/site-traffic";

type TrafficEnvironment = {
  SITE_TRAFFIC_HASH_SECRET?: string;
};

export async function POST(request: Request) {
  try {
    const environment = await directoryEnv() as Awaited<ReturnType<typeof directoryEnv>> & TrafficEnvironment;
    if (!environment.SITE_TRAFFIC_HASH_SECRET || environment.SITE_TRAFFIC_HASH_SECRET.length < 32) {
      return Response.json({ error: "방문자 집계가 준비되지 않았습니다." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const result = await recordTodayVisitor(
      environment.DB,
      request,
      environment.SITE_TRAFFIC_HASH_SECRET,
    );
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("daily visitor count failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return Response.json({ error: "오늘 방문자 수를 불러오지 못했습니다." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
