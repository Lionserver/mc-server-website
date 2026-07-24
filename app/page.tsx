import { HomeDirectory, type Server } from "@/components/home-directory";
import { publicServerList } from "@/lib/public-directory";
import { requestSiteOrigin } from "@/lib/site-url";

export const revalidate = 30;

export default async function HomePage() {
  const origin = await requestSiteOrigin();
  let initialServers: Server[] = [];
  let initialGeneratedAt: number | null = null;
  let initialLoaded = false;
  let total = 0;

  try {
    const payload = await publicServerList(
      new Request(`${origin}/api/servers?limit=100`),
    );
    initialServers = payload.servers;
    initialGeneratedAt = payload.generatedAt;
    initialLoaded = true;
    total = payload.total;
  } catch {
    // The client performs the same request after hydration if the initial D1
    // read is temporarily unavailable.
  }

  const itemList = initialServers.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${origin}/#server-directory`,
    name: "한국 마인크래프트 서버 목록",
    numberOfItems: total,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: initialServers.map((server, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: server.name,
      url: `${origin}/servers/${server.id}`,
    })),
  } : null;

  return <>
    {itemList ? <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(itemList) }}
    /> : null}
    <HomeDirectory
      initialServers={initialServers}
      initialGeneratedAt={initialGeneratedAt}
      initialLoaded={initialLoaded}
    />
  </>;
}

function safeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
