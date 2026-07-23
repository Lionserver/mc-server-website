export function GET() {
  return Response.json({ service: "minecraft-kr-bridge", ok: true, protocolVersion: 1 });
}
