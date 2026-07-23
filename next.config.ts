import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Vinext also applies this guarded body limit to App Router route handlers.
      // Keep multipart overhead above the application's 8MB image limit.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
