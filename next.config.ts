import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Shopify app proxies append a slash when forwarding their root route. Let
  // src/proxy.ts rewrite that one signed webhook request without a redirect.
  skipTrailingSlashRedirect: true,
  // The image library is a single static file in public/. This gives it a
  // clean path; it fills an unused route and leaves every existing one alone.
  async rewrites() {
    return [{ source: "/library", destination: "/library.html" }];
  },
};
export default nextConfig;
