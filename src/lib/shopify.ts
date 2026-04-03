import { fetchWithRetry } from "@/lib/fetch-retry";

export interface ShopifyStoreConfig {
  id: string;
  label: string;
  store: string;
  clientId: string;
  clientSecret: string;
}

// Build store list from env vars — only include stores with all 3 credentials set
function buildStores(): ShopifyStoreConfig[] {
  const stores: ShopifyStoreConfig[] = [];
  for (let i = 1; i <= 3; i++) {
    const store = process.env[`SHOPIFY_STORE_${i}`];
    const clientId = process.env[`SHOPIFY_CLIENT_ID_${i}`];
    const clientSecret = process.env[`SHOPIFY_CLIENT_SECRET_${i}`];
    if (store && clientId && clientSecret) {
      stores.push({
        id: `store${i}`,
        label: process.env[`SHOPIFY_LABEL_${i}`] ?? `Store ${i}`,
        store,
        clientId,
        clientSecret,
      });
    }
  }
  return stores;
}

export const STORES: ShopifyStoreConfig[] = buildStores();

export function getStores(): ShopifyStoreConfig[] {
  return STORES;
}

// Token cache keyed by store id
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken(config: ShopifyStoreConfig): Promise<string> {
  const cached = tokenCache.get(config.id);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const res = await fetchWithRetry(`https://${config.store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify auth failed for ${config.label}: ${res.status} ${text}`);
  }

  const data = await res.json();
  tokenCache.set(config.id, {
    token: data.access_token,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  });
  return data.access_token;
}

export async function shopifyGraphQL<T = unknown>(
  storeId: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const config = STORES.find((s) => s.id === storeId);
  if (!config) throw new Error(`Unknown store: ${storeId}`);

  const token = await getToken(config);

  const res = await fetchWithRetry(
    `https://${config.store}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL error (${config.label}): ${res.status} ${text}`);
  }

  const json = await res.json();
  if (json.errors && !json.data) {
    // Total failure — no usable data returned
    throw new Error(json.errors.map((e: { message: string }) => e.message).join(", "));
  }
  if (json.errors && json.data) {
    // Partial failure — some fields (e.g. staffMember) may be null due to missing scopes.
    // Log but continue with whatever data we got.
    const uniqueMessages = [...new Set(json.errors.map((e: { message: string }) => e.message))];
    console.warn(`[shopify] Partial GraphQL errors (${config.label}): ${uniqueMessages.join("; ")}`);
  }

  return json.data as T;
}

// ─── Net Revenue Helpers ──────────────────────────────────────────────────────
// Revenue = subtotal (after discounts, before tax/shipping)
//         - custom.shipping_cost metafield
//         - custom.us_export_tariff metafield

/** GraphQL fields to include in order queries for net revenue calculation */
export const REVENUE_FIELDS = `
  subtotalPriceSet { shopMoney { amount } }
  shippingCostMeta: metafield(namespace: "custom", key: "shipping_cost") { value }
  exportTariffMeta: metafield(namespace: "custom", key: "us_export_tariff") { value }
`;

export interface RevenueFields {
  subtotalPriceSet: { shopMoney: { amount: string } };
  shippingCostMeta: { value: string } | null;
  exportTariffMeta: { value: string } | null;
}

/** Calculate net revenue from an order with revenue fields */
export function calcNetRevenue(order: RevenueFields): number {
  const subtotal = parseFloat(order.subtotalPriceSet.shopMoney.amount);
  const shippingCost = parseFloat(order.shippingCostMeta?.value ?? "0") || 0;
  const exportTariff = parseFloat(order.exportTariffMeta?.value ?? "0") || 0;
  return subtotal - shippingCost - exportTariff;
}
