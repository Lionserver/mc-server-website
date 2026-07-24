import type { MetadataRoute } from "next";
import { indexablePublicServerUrls } from "@/lib/public-server-seo";
import { configuredSiteOrigin } from "@/lib/site-url";

export const revalidate = 3_600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = configuredSiteOrigin();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${origin}/`,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${origin}/broadcasts`,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${origin}/privacy`,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    {
      url: `${origin}/terms`,
      changeFrequency: "monthly",
      priority: 0.2,
    },
  ];

  try {
    const servers = await indexablePublicServerUrls(49_996);
    return [
      ...staticRoutes,
      ...servers.map((server) => ({
        url: `${origin}/servers/${server.id}`,
        lastModified: new Date(server.updatedAt * 1_000),
        changeFrequency: "hourly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    return staticRoutes;
  }
}
