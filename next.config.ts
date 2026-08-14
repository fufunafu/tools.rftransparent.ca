import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Shopify app proxies append a slash when forwarding their root route. Let
  // src/proxy.ts rewrite that one signed webhook request without a redirect.
  skipTrailingSlashRedirect: true,
};
export default nextConfig;
