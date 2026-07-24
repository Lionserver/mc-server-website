import type { MetadataRoute } from "next";
import { configuredSiteOrigin } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const origin = configuredSiteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/login",
        "/operator",
        "/api/admin/",
        "/api/auth/",
        "/api/bridge/",
        "/api/operator/",
        "/api/premium/",
        "/api/realtime/",
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
