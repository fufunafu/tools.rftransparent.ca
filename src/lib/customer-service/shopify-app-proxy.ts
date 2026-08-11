import { createHmac, timingSafeEqual } from "node:crypto";

const APP_PROXY_MAX_AGE_SECONDS = 5 * 60;
const SHOPIFY_HOST_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export type ShopifyAppProxyVerification =
  | { ok: true; shop: string }
  | {
      ok: false;
      reason:
        | "invalid_request"
        | "expired_request"
        | "unknown_shop"
        | "missing_secret";
      diagnostic?: {
        shop: string;
        matchingSecretSlots: number[];
      };
    };

function normalizeShop(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "") ?? "";
  return SHOPIFY_HOST_PATTERN.test(normalized) ? normalized : null;
}

function proxySecretForShop(shop: string): string | null {
  for (let index = 1; index <= 3; index++) {
    if (normalizeShop(process.env[`SHOPIFY_STORE_${index}`]) !== shop) continue;
    return (
      process.env[`SHOPIFY_APP_PROXY_SECRET_${index}`]?.trim() ||
      process.env[`SHOPIFY_CLIENT_SECRET_${index}`]?.trim() ||
      null
    );
  }
  return null;
}

/**
 * Shopify signs app proxy query parameters by grouping duplicate values,
 * sorting each key/value pair, and concatenating the pairs without separators.
 */
export function shopifyAppProxySignatureMessage(searchParams: URLSearchParams): string {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of searchParams.entries()) {
    if (key === "signature") continue;
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }

  return [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");
}

function signatureMatches(
  url: URL,
  signature: string,
  secret: string,
): boolean {
  if (signatureMatchesSearchParams(url.searchParams, signature, secret)) {
    return true;
  }

  // Next.js can remove Shopify's empty logged_in_customer_id query parameter
  // while normalizing the trailing-slash rewrite. Shopify includes that empty
  // pair in the signed message for anonymous storefront visitors, so restore it
  // only for a second HMAC comparison when it is absent from the received URL.
  if (!url.searchParams.has("logged_in_customer_id")) {
    const restoredParams = new URLSearchParams(url.searchParams);
    restoredParams.set("logged_in_customer_id", "");
    return signatureMatchesSearchParams(restoredParams, signature, secret);
  }

  return false;
}

function signatureMatchesSearchParams(
  searchParams: URLSearchParams,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(shopifyAppProxySignatureMessage(searchParams))
    .digest();
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function verifyShopifyAppProxyRequest(
  url: URL,
  nowMs = Date.now(),
): ShopifyAppProxyVerification {
  const shop = normalizeShop(url.searchParams.get("shop"));
  const signature = url.searchParams.get("signature")?.trim().toLowerCase() ?? "";
  const timestamp = Number(url.searchParams.get("timestamp"));

  if (!shop || !/^[0-9a-f]{64}$/.test(signature) || !Number.isSafeInteger(timestamp)) {
    return { ok: false, reason: "invalid_request" };
  }

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestamp);
  if (ageSeconds > APP_PROXY_MAX_AGE_SECONDS) {
    return { ok: false, reason: "expired_request" };
  }

  const secret = proxySecretForShop(shop);
  if (!secret) {
    const configuredShop = [1, 2, 3].some(
      (index) => normalizeShop(process.env[`SHOPIFY_STORE_${index}`]) === shop,
    );
    return {
      ok: false,
      reason: configuredShop ? "missing_secret" : "unknown_shop",
    };
  }

  if (!signatureMatches(url, signature, secret)) {
    const matchingSecretSlots: number[] = [];
    for (let index = 1; index <= 3; index++) {
      const candidates = [
        process.env[`SHOPIFY_APP_PROXY_SECRET_${index}`]?.trim(),
        process.env[`SHOPIFY_CLIENT_SECRET_${index}`]?.trim(),
      ].filter((candidate): candidate is string => Boolean(candidate));
      if (candidates.some((candidate) => signatureMatches(url, signature, candidate))) {
        matchingSecretSlots.push(index);
      }
    }
    return {
      ok: false,
      reason: "invalid_request",
      diagnostic: { shop, matchingSecretSlots },
    };
  }

  return { ok: true, shop };
}
