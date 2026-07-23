import { publicServerDetail } from "@/lib/public-directory";
import { directoryEnv } from "@/lib/server-directory";

type RouteContext = { params: Promise<{ serverId: string }> | { serverId: string } };

export async function GET(request: Request, context: RouteContext) {
  const { serverId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(serverId)) return new Response("invalid server", { status: 400 });
  const environment = await directoryEnv();
  const server = await publicServerDetail(environment.DB, serverId);
  if (!server) return new Response("server not found", { status: 404 });

  const origin = new URL(request.url).origin;
  const detailUrl = `${origin}/?server=${server.id}`;
  const icon = server.hasIcon ? `${origin}/api/servers/${server.id}/assets/icon` : "";
  const statusClass = server.online ? "online" : "offline";
  const statusLabel = server.online ? "NOW BOARDING" : "GATE CLOSED";
  const initials = server.name.trim().split(/\s+/).map((word) => word[0] ?? "").join("").slice(0, 2).toUpperCase() || "MK";
  const passengerValue = `${formatNumber(server.players)} / ${formatNumber(server.capacity)}`;
  const versionValue = server.version;
  const uptimeValue = `${server.uptime}%`;
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>${escapeHtml(server.name)} · Minecraft.kr Server Pass</title><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;min-height:190px;margin:0;overflow:hidden;background:transparent;color:#eef7f2;font-family:Inter,Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.pass{position:relative;width:100%;height:190px;overflow:hidden;border:1px solid #273c35;background:#0b1512;display:grid;grid-template-columns:minmax(0,1fr) 178px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}.pass:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 12% -20%,rgba(69,220,158,.18),transparent 32%),linear-gradient(110deg,transparent 0 72%,rgba(255,255,255,.025) 72% 100%);pointer-events:none}.main{position:relative;min-width:0;padding:20px 24px;display:grid;grid-template-columns:72px minmax(0,1fr);grid-template-rows:auto 1fr auto;gap:9px 16px}.eyebrow{grid-column:1/-1;display:flex;align-items:center;gap:8px;color:#58da9f;font:800 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}.eyebrow i{width:7px;height:7px;background:#58da9f;box-shadow:0 0 0 4px rgba(88,218,159,.12)}.mark{grid-row:2;width:72px;height:72px;border:1px solid #365248;background:#14231e;color:#58da9f;display:grid;place-items:center;font-size:24px;font-weight:900;overflow:hidden}.mark img{width:100%;height:100%;display:block;object-fit:cover;image-rendering:auto}.identity{min-width:0;align-self:center}.identity h1{margin:0 0 5px;overflow:hidden;color:#fff;font-size:24px;line-height:1.15;letter-spacing:-.04em;white-space:nowrap;text-overflow:ellipsis}.address{display:flex;align-items:center;gap:7px;color:#9ab0a8;font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.address b{overflow:hidden;color:#58da9f;text-overflow:ellipsis}.metrics{grid-column:1/-1;display:grid;grid-template-columns:1.2fr .9fr .9fr;border-top:1px solid #24372f}.metric{min-width:0;padding:9px 12px 0 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto);gap:2px 8px;container-type:inline-size}.metric+.metric{padding-left:14px;border-left:1px solid #24372f}.metric span{color:#73877f;font-size:8px;font-weight:800;letter-spacing:.08em}.metric strong{max-width:100%;grid-row:1/3;grid-column:2;overflow:hidden;color:#eef7f2;font-size:clamp(10px,8cqi,15px);line-height:1.1;letter-spacing:-.02em;white-space:nowrap;text-overflow:ellipsis}.metric strong.fit-medium{font-size:clamp(9px,7cqi,13px)}.metric strong.fit-small{font-size:clamp(8px,6cqi,11px)}.metric strong.fit-tiny{font-size:clamp(7px,5cqi,9px)}.metric small{overflow:hidden;color:#9ab0a8;font-size:8px;white-space:nowrap;text-overflow:ellipsis}.stub{position:relative;padding:20px 18px;border-left:1px dashed #486158;background:#101d19;display:flex;flex-direction:column;justify-content:space-between;text-align:right}.stub:before,.stub:after{content:"";position:absolute;left:-8px;width:15px;height:15px;border-radius:50%;background:#fff}.stub:before{top:-8px}.stub:after{bottom:-8px}.stub small{color:#73877f;font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.11em}.stub b{display:block;margin-top:5px;color:#eef7f2;font-size:13px}.route{display:flex;align-items:center;justify-content:flex-end;gap:8px;color:#58da9f;font:900 21px ui-monospace,SFMono-Regular,Menlo,monospace}.route i{width:30px;height:1px;background:#58da9f;position:relative}.route i:after{content:"";position:absolute;right:0;top:-3px;width:6px;height:6px;border-top:1px solid #58da9f;border-right:1px solid #58da9f;transform:rotate(45deg)}.stub .state{padding:8px 9px;border:1px solid #355146;color:#58da9f;font:900 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-align:center}.offline .stub .state{border-color:#66413e;color:#e77970}.stub em{color:#73877f;font:700 8px ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal}.click{position:absolute;inset:0;z-index:5}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.metric{padding:9px 14px 0;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto;align-content:center;justify-items:start;gap:2px}.metric+.metric{padding-left:14px}.metric strong{display:block;grid-row:auto;grid-column:auto;margin-top:1px;font-size:clamp(11px,10cqi,16px)}.metric strong.fit-medium{font-size:clamp(10px,8.5cqi,15px)}.metric strong.fit-small{font-size:clamp(9px,7.5cqi,13px)}.metric strong.fit-tiny{font-size:clamp(8px,6.5cqi,11px)}
@media(max-width:520px){.pass{grid-template-columns:minmax(0,1fr) 104px}.main{padding:15px 13px;grid-template-columns:54px minmax(0,1fr);gap:8px 10px}.eyebrow{font-size:7px}.mark{width:54px;height:54px;font-size:18px}.identity h1{font-size:17px}.address{font-size:9px}.metrics{grid-template-columns:1fr 1fr}.metric{padding:8px 8px 0}.metric+.metric{padding-left:8px}.metric:nth-child(3){display:none}.metric strong{font-size:clamp(9px,10cqi,13px)}.metric strong.fit-medium{font-size:clamp(8px,9cqi,12px)}.metric strong.fit-small{font-size:clamp(7px,8cqi,11px)}.metric strong.fit-tiny{font-size:clamp(7px,7cqi,10px)}.metric small{font-size:7px}.stub{padding:15px 10px}.stub small{font-size:6px}.stub b{font-size:9px}.route{font-size:14px;gap:4px}.route i{width:15px}.stub .state{padding:7px 3px;font-size:7px}.stub em{font-size:6px}}
</style></head><body><article class="pass ${statusClass}" aria-label="${escapeHtml(server.name)} Minecraft 서버 탑승권"><section class="main"><div class="eyebrow"><i></i>MINECRAFT.KR · VERIFIED SERVER PASS</div><div class="mark">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(initials)}</div><div class="identity"><h1>${escapeHtml(server.name)}</h1><div class="address"><span>GATE</span><b>${escapeHtml(server.address)}</b></div></div><div class="metrics"><div class="metric"><span>PASSENGERS</span><strong class="${fitTextClass(passengerValue)}" title="${escapeHtml(passengerValue)}">${escapeHtml(passengerValue)}</strong><small>${server.online ? "현재 접속 인원" : "서버 응답 대기 중"}</small></div><div class="metric"><span>VERSION</span><strong class="${fitTextClass(versionValue)}" title="${escapeHtml(versionValue)}">${escapeHtml(versionValue)}</strong><small>${escapeHtml(server.edition)} EDITION</small></div><div class="metric"><span>UPTIME</span><strong class="${fitTextClass(uptimeValue)}" title="${escapeHtml(uptimeValue)}">${escapeHtml(uptimeValue)}</strong><small>최근 30일 기준</small></div></div></section><aside class="stub"><div><small>BOARDING PASS</small><b>MKR-${server.id.slice(0, 6).toUpperCase()}</b></div><div class="route"><span>LIST</span><i></i><span>PLAY</span></div><div class="state">${statusLabel}</div><em>AUTO REFRESH · 30 SEC</em></aside><a class="click" href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer"><span class="sr">${escapeHtml(server.name)} 서버 상세보기</span></a></article></body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=15, stale-while-revalidate=15",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function fitTextClass(value: string) {
  const visualUnits = Array.from(value).reduce((total, character) => total + (character.charCodeAt(0) > 0x7f ? 1.7 : /[MW@%]/.test(character) ? 1.25 : 1), 0);
  if (visualUnits > 18) return "fit-tiny";
  if (visualUnits > 13) return "fit-small";
  if (visualUnits > 8) return "fit-medium";
  return "fit-normal";
}
