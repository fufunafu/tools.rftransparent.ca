import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  shopifyAppProxySignatureMessage,
  verifyShopifyAppProxyRequest,
} from "@/lib/customer-service/shopify-app-proxy";

const originalStore = process.env.SHOPIFY_STORE_1;
const originalSecret = process.env.SHOPIFY_CLIENT_SECRET_1;
const originalStore2 = process.env.SHOPIFY_STORE_2;
const originalSecret2 = process.env.SHOPIFY_CLIENT_SECRET_2;
const originalProxySecret2 = process.env.SHOPIFY_APP_PROXY_SECRET_2;

afterEach(() => {
  if (originalStore === undefined) delete process.env.SHOPIFY_STORE_1;
  else process.env.SHOPIFY_STORE_1 = originalStore;
  if (originalSecret === undefined) delete process.env.SHOPIFY_CLIENT_SECRET_1;
  else process.env.SHOPIFY_CLIENT_SECRET_1 = originalSecret;
  if (originalStore2 === undefined) delete process.env.SHOPIFY_STORE_2;
  else process.env.SHOPIFY_STORE_2 = originalStore2;
  if (originalSecret2 === undefined) delete process.env.SHOPIFY_CLIENT_SECRET_2;
  else process.env.SHOPIFY_CLIENT_SECRET_2 = originalSecret2;
  if (originalProxySecret2 === undefined) delete process.env.SHOPIFY_APP_PROXY_SECRET_2;
  else process.env.SHOPIFY_APP_PROXY_SECRET_2 = originalProxySecret2;
});

describe("Shopify app proxy verification", () => {
  it("matches Shopify's documented duplicate-parameter signature example", () => {
    const params = new URLSearchParams(
      "extra=1&extra=2&shop=example.myshopify.com&logged_in_customer_id=1" +
        "&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555",
    );

    expect(shopifyAppProxySignatureMessage(params)).toBe(
      "extra=1,2logged_in_customer_id=1path_prefix=/apps/awesome_reviews" +
        "shop=example.myshopify.comtimestamp=1317327555",
    );
  });

  it("accepts a current request signed by the configured Shopify app", () => {
    process.env.SHOPIFY_STORE_1 = "example.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET_1 = "hush";
    const nowMs = Date.UTC(2026, 7, 7, 14, 0, 0);
    const timestamp = Math.floor(nowMs / 1000);
    const url = new URL(
      `https://tools.rftransparent.ca/api/customer-service/leads/webhook` +
        `?shop=example.myshopify.com&timestamp=${timestamp}&path_prefix=%2Fapps%2Frf-leads`,
    );
    const signature = createHmac("sha256", "hush")
      .update(shopifyAppProxySignatureMessage(url.searchParams))
      .digest("hex");
    url.searchParams.set("signature", signature);

    expect(verifyShopifyAppProxyRequest(url, nowMs)).toEqual({
      ok: true,
      shop: "example.myshopify.com",
    });
  });

  it("restores Shopify's signed empty customer parameter after URL normalization", () => {
    process.env.SHOPIFY_STORE_1 = "example.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET_1 = "hush";
    const nowMs = Date.UTC(2026, 7, 7, 14, 0, 0);
    const timestamp = Math.floor(nowMs / 1000);
    const signedParams = new URLSearchParams({
      action: "create-upload",
      logged_in_customer_id: "",
      path_prefix: "/apps/rf-leads",
      shop: "example.myshopify.com",
      timestamp: String(timestamp),
    });
    const signature = createHmac("sha256", "hush")
      .update(shopifyAppProxySignatureMessage(signedParams))
      .digest("hex");
    signedParams.delete("logged_in_customer_id");
    signedParams.set("signature", signature);
    const url = new URL(
      `https://tools.rftransparent.ca/api/customer-service/leads/webhook?${signedParams}`,
    );

    expect(verifyShopifyAppProxyRequest(url, nowMs)).toEqual({
      ok: true,
      shop: "example.myshopify.com",
    });
  });

  it("rejects stale signed requests to limit replay", () => {
    process.env.SHOPIFY_STORE_1 = "example.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET_1 = "hush";
    const url = new URL(
      "https://tools.rftransparent.ca/api/customer-service/leads/webhook" +
        "?shop=example.myshopify.com&timestamp=1317327555" +
        "&signature=e072b6d7e6622d85912a5214b860d3100dc1e73d9bc29f43796ac8c9ff8093cb",
    );

    expect(verifyShopifyAppProxyRequest(url, Date.UTC(2026, 7, 7))).toEqual({
      ok: false,
      reason: "expired_request",
    });
  });

  it("identifies a configured secret slot when the shop mapping is wrong", () => {
    process.env.SHOPIFY_STORE_1 = "different.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET_1 = "matching-secret";
    process.env.SHOPIFY_STORE_2 = "example.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET_2 = "mapped-but-wrong-secret";
    const nowMs = Date.UTC(2026, 7, 7, 14, 0, 0);
    const timestamp = Math.floor(nowMs / 1000);
    const url = new URL(
      `https://tools.rftransparent.ca/api/customer-service/leads/webhook` +
        `?shop=example.myshopify.com&timestamp=${timestamp}&path_prefix=%2Fapps%2Frf-leads`,
    );
    const signature = createHmac("sha256", "matching-secret")
      .update(shopifyAppProxySignatureMessage(url.searchParams))
      .digest("hex");
    url.searchParams.set("signature", signature);

    expect(verifyShopifyAppProxyRequest(url, nowMs)).toEqual({
      ok: false,
      reason: "invalid_request",
      diagnostic: {
        shop: "example.myshopify.com",
        matchingSecretSlots: [1],
      },
    });
  });

  it("prefers a dedicated App Proxy secret over the Admin API client secret", () => {
    process.env.SHOPIFY_STORE_2 = "example.myshopify.com";
    process.env.SHOPIFY_CLIENT_SECRET_2 = "admin-api-secret";
    process.env.SHOPIFY_APP_PROXY_SECRET_2 = "proxy-app-secret";
    const nowMs = Date.UTC(2026, 7, 7, 14, 0, 0);
    const timestamp = Math.floor(nowMs / 1000);
    const url = new URL(
      `https://tools.rftransparent.ca/api/customer-service/leads/webhook` +
        `?shop=example.myshopify.com&timestamp=${timestamp}&path_prefix=%2Fapps%2Frf-leads`,
    );
    const signature = createHmac("sha256", "proxy-app-secret")
      .update(shopifyAppProxySignatureMessage(url.searchParams))
      .digest("hex");
    url.searchParams.set("signature", signature);

    expect(verifyShopifyAppProxyRequest(url, nowMs)).toEqual({
      ok: true,
      shop: "example.myshopify.com",
    });
  });
});
