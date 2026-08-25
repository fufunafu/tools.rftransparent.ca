// Which store a lead belongs to. Mirrors the phone dashboard's store ids so
// the customer-service pages share one RF / BC vocabulary.

import { STORE_SCOPES } from "@/lib/store-scopes";

export type LeadStoreId = "rf_transparent" | "bc_transparent";

export const DEFAULT_LEAD_STORE: LeadStoreId = "rf_transparent";

export const LEAD_STORE_OPTIONS: { id: LeadStoreId; label: string }[] = [
  { id: "rf_transparent", label: "RF Transparent" },
  { id: "bc_transparent", label: "BC Transparent" },
];

export type LeadStoreSlug = "rf" | "bc";

const SLUG_TO_STORE: Record<LeadStoreSlug, LeadStoreId> = {
  rf: "rf_transparent",
  bc: "bc_transparent",
};

export function leadStoreFromSlug(slug: string | null | undefined): LeadStoreId | null {
  return slug === "rf" || slug === "bc" ? SLUG_TO_STORE[slug] : null;
}

export function leadStoreSlug(storeId: LeadStoreId): LeadStoreSlug {
  return storeId === "bc_transparent" ? "bc" : "rf";
}

/** URL for a store's leads page, e.g. /customer-service/leads/bc/analysis. */
export function leadsPath(storeId: LeadStoreId, section?: "analysis"): string {
  const base = `/customer-service/leads/${leadStoreSlug(storeId)}`;
  return section ? `${base}/${section}` : base;
}

export function isLeadStoreId(value: unknown): value is LeadStoreId {
  return value === "rf_transparent" || value === "bc_transparent";
}

export function leadStoreLabel(storeId: LeadStoreId): string {
  return LEAD_STORE_OPTIONS.find((option) => option.id === storeId)?.label ?? storeId;
}

/** Same default the phone page uses: Quebec visitors start on BC. */
export function defaultLeadStoreForRegion(region: string | null | undefined): LeadStoreId {
  return region === "QC" ? "bc_transparent" : DEFAULT_LEAD_STORE;
}

function normalizeShop(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

/**
 * Map the myshopify domain that signed an app-proxy request to a lead store.
 * SHOPIFY_STORE_N slots are bridged to phone/lead ids through STORE_SCOPES
 * (store3 → Montreal → bc_transparent). Unknown shops fall back to RF so a
 * misconfigured slot never drops a lead.
 */
export function leadStoreForShopifyShop(
  shop: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): LeadStoreId {
  const normalized = normalizeShop(shop);
  if (!normalized) return DEFAULT_LEAD_STORE;
  for (let index = 1; index <= 3; index++) {
    if (normalizeShop(env[`SHOPIFY_STORE_${index}`]) !== normalized) continue;
    const shopifyStoreId = `store${index}`;
    for (const scope of Object.values(STORE_SCOPES)) {
      if (!scope.shopifyStoreIds.includes(shopifyStoreId)) continue;
      const storeId = scope.phoneStoreIds.find(isLeadStoreId);
      if (storeId) return storeId;
    }
  }
  return DEFAULT_LEAD_STORE;
}
