import "server-only";
import { AmazonError, AMAZON_US, type ListingDraft, type ListingResult, type ProductSchema } from "./domain";

const ENV_KEYS = ["AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN", "AMAZON_SP_API_SELLER_ID"] as const;

export function amazonReadiness() {
  const missing = ENV_KEYS.filter((key) => !process.env[key]?.trim());
  return { configured: missing.length === 0, missing, marketplace: "United States", currency: "USD" };
}

export function amazonConfig() {
  if (!amazonReadiness().configured) throw new AmazonError("Amazon connection needs to be configured by your administrator.", 503);
  return {
    clientId: process.env.AMAZON_SP_API_CLIENT_ID!, clientSecret: process.env.AMAZON_SP_API_CLIENT_SECRET!,
    refreshToken: process.env.AMAZON_SP_API_REFRESH_TOKEN!, sellerId: process.env.AMAZON_SP_API_SELLER_ID!,
  };
}

// Request-scoped client keeps credentials and access tokens on the server.
export class AmazonClient {
  private token?: string;
  private config = amazonConfig();

  private async accessToken() {
    if (this.token) return this.token;
    const response = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken }),
    });
    if (!response.ok) throw new AmazonError("Amazon authorization failed. Check the private app credentials and authorization.", 502);
    const body = await response.json();
    if (typeof body.access_token !== "string") throw new AmazonError("Amazon did not return an access token.", 502);
    this.token = body.access_token as string;
    return this.token;
  }

  async request<T>(path: string, query: Record<string, string> = {}, method = "GET", body?: unknown): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(`https://sellingpartnerapi-na.amazon.com${path}?${new URLSearchParams({ marketplaceIds: AMAZON_US, ...query })}`, {
      method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "x-amz-access-token": token, "Content-Type": "application/json", "User-Agent": "RF-Tools/1.0 (Language=TypeScript)" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const message = response.status === 429 ? "Amazon is busy. Wait a moment and retry."
        : response.status === 403 ? "Amazon denied access. Check the Product Listing role and seller authorization."
        : `Amazon request failed (${response.status}). Check the listing in Seller Central before retrying an upload.`;
      throw new AmazonError(message, response.status === 404 ? 404 : 502);
    }
    return response.json() as Promise<T>;
  }

  searchTypes(keywords: string) {
    return this.request<{ productTypes: { name: string; displayName: string }[] }>("/definitions/2020-09-01/productTypes", { keywords, locale: "en_US" });
  }

  async definition(productType: string): Promise<ProductSchema> {
    const result = await this.request<{ schema: { link: { resource: string } } }>(`/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`, {
      sellerId: this.config.sellerId, requirements: "LISTING", requirementsEnforced: "ENFORCED", locale: "en_US", parentageLevel: "NONE",
    });
    const url = new URL(result.schema.link.resource);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".amazonaws.com")) throw new AmazonError("Amazon returned an unexpected product definition location.", 502);
    // The presigned schema download receives no Amazon access-token header.
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new AmazonError("Amazon product requirements could not be loaded.", 502);
    return response.json();
  }

  private listingPath(sku: string) {
    return `/listings/2021-08-01/items/${encodeURIComponent(this.config.sellerId)}/${encodeURIComponent(sku)}`;
  }

  async listing(sku: string) {
    try {
      return await this.request<{ sku: string; summaries?: { asin: string; status: string[] }[]; issues?: ListingResult["issues"] }>(this.listingPath(sku), { includedData: "summaries,issues", issueLocale: "en_US" });
    } catch (error) {
      if (error instanceof AmazonError && error.status === 404) return null;
      throw error;
    }
  }

  async ensureNew(sku: string) {
    if (await this.listing(sku)) throw new AmazonError("This SKU already exists on Amazon. Open it in Seller Central to review or update it.", 409);
  }

  put(draft: ListingDraft, preview: boolean) {
    return this.request<ListingResult>(this.listingPath(draft.sku), {
      issueLocale: "en_US", ...(preview ? { mode: "VALIDATION_PREVIEW" } : {}),
    }, "PUT", { productType: draft.productType, attributes: draft.attributes, requirements: "LISTING" });
  }
}
