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
        matchingSignatureModes: string[];
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
  return signatureMatchesMessage(
    signature,
    secret,
    shopifyAppProxySignatureMessage(url.searchParams),
  );
}

function signatureMatchesMessage(
  signature: string,
  secret: string,
  message: string,
): boolean {
  const expected = createHmac("sha256", secret).update(message).digest();
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function signatureDiagnosticModes(
  url: URL,
  signature: string,
  secret: string,
): string[] {
  const canonicalMessage = shopifyAppProxySignatureMessage(url.searchParams);
  const decodedAmpersandMessage = canonicalMessageFromParams(
    url.searchParams,
    "&",
  );
  const rawSortedMessage = url.search
    .slice(1)
    .split("&")
    .filter((pair) => pair && decodeQueryKey(pair) !== "signature")
    .sort()
    .join("");
  const withoutAction = new URLSearchParams(url.searchParams);
  withoutAction.delete("action");

  const modes = [
    {
      name: "raw_encoded_values",
      key: secret,
      message: rawSortedMessage,
    },
    {
      name: "decoded_ampersand_separated",
      key: secret,
      message: decodedAmpersandMessage,
    },
    {
      name: "action_not_signed",
      key: secret,
      message: shopifyAppProxySignatureMessage(withoutAction),
    },
    {
      name: "secret_without_shpss_prefix",
      key: secret.startsWith("shpss_") ? secret.slice("shpss_".length) : "",
      message: canonicalMessage,
    },
  ];

  return modes
    .filter(
      ({ key, message }) =>
        key &&
        (key !== secret || message !== canonicalMessage) &&
        signatureMatchesMessage(signature, key, message),
    )
    .map(({ name }) => name);
}

function canonicalMessageFromParams(
  searchParams: URLSearchParams,
  separator: string,
): string {
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
    .join(separator);
}

function decodeQueryKey(pair: string): string {
  const equalsIndex = pair.indexOf("=");
  const rawKey = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex);
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, " "));
  } catch {
    return rawKey;
  }
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
      diagnostic: {
        shop,
        matchingSecretSlots,
        matchingSignatureModes: signatureDiagnosticModes(
          url,
          signature,
          secret,
        ),
      },
    };
  }

  return { ok: true, shop };
}
