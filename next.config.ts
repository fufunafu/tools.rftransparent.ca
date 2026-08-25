import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Shopify app proxies append a slash when forwarding their root route. Let
  // src/proxy.ts rewrite that one signed webhook request without a redirect.
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: "/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};
export default nextConfig;
