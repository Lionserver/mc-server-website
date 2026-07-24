import type { MetadataRoute } from "next";
import { indexablePublicServerUrls } from "@/lib/public-server-seo";
import { configuredSiteOrigin } from "@/lib/site-url";

export const revalidate = 3_600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = configuredSiteOrigin();
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${origin}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${origin}/broadcasts`,
      lastModified: now,
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
    const servers = await indexablePublicServerUrls();
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
