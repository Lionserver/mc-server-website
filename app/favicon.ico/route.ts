export function GET(request: Request) {
  return new Response(null, {
    status: 308,
    headers: {
      Location: new URL("/icon-192.png", request.url).toString(),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
