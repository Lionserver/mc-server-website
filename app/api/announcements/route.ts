import { directoryEnv } from "@/lib/server-directory";
import { publicAnnouncementState } from "@/lib/site-announcements";

export async function GET() {
  try {
    const environment = await directoryEnv();
    return Response.json(await publicAnnouncementState(environment.DB), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "공지사항을 불러오지 못했습니다." }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
