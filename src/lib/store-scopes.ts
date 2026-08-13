// Canonical bridge between the three store id namespaces:
//   - Shopify store ids ("store1"/"store2"/"store3", from SHOPIFY_STORE_* env)
//   - phone/lead store ids ("rf_transparent"/"glass_railing_store"/"bc_transparent")
//   - the `locations` table rows ("Toronto"/"Montreal") that employees belong to
// New code should look store relationships up here instead of hardcoding
// another mapping. (Older duplicates, e.g. CustomerServiceDashboard's
// STORE_OPTIONS, still carry their own lists — migrating them is follow-up work.)

export interface StoreScope {
  slug: "toronto" | "montreal";
  label: string;
  // Shopify ids this location sells through.
  shopifyStoreIds: string[];
  // Phone/lead system ids for this location's lines and inboxes.
  phoneStoreIds: string[];
  // Must match `locations.name` so employees can be tied to a scope.
  locationName: string;
  // The physical warehouse is in Toronto; its numbers are company-wide, so
  // only Toronto's dashboard shows the warehouse card.
  showWarehouse: boolean;
}

export const STORE_SCOPES: Record<string, StoreScope> = {
  toronto: {
    slug: "toronto",
    label: "Toronto",
    shopifyStoreIds: ["store1", "store2"],
    phoneStoreIds: ["rf_transparent", "glass_railing_store"],
    locationName: "Toronto",
    showWarehouse: true,
  },
  montreal: {
    slug: "montreal",
    label: "Montreal",
    shopifyStoreIds: ["store3"],
    phoneStoreIds: ["bc_transparent"],
    locationName: "Montreal",
    showWarehouse: false,
  },
};

export function getStoreScope(slug: string): StoreScope | null {
  return STORE_SCOPES[slug.toLowerCase()] ?? null;
}

/** The scope whose shopify_store_ids overlap the given location row, if any. */
export function scopeForShopifyStoreIds(shopifyStoreIds: string[]): StoreScope | null {
  for (const scope of Object.values(STORE_SCOPES)) {
    if (shopifyStoreIds.some((id) => scope.shopifyStoreIds.includes(id))) return scope;
  }
  return null;
}

/** The scope matching a `locations.name` value, if any. */
export function scopeForLocationName(name: string): StoreScope | null {
  const normalized = name.trim().toLowerCase();
  return Object.values(STORE_SCOPES).find((s) => s.locationName.toLowerCase() === normalized) ?? null;
}
