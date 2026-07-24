import type { MetadataRoute } from "next";
import { configuredSiteOrigin } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const origin = configuredSiteOrigin();
  const privateApiPaths = [
    "/api/admin/",
    "/api/auth/",
    "/api/bridge/",
    "/api/operator/",
    "/api/premium/",
    "/api/realtime/",
    "/api/traffic/",
  ];
  return {
    rules: [
      {
        userAgent: ["GPTBot", "ClaudeBot", "Google-Extended"],
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: privateApiPaths,
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
