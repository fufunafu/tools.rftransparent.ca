import { describe, expect, it } from "vitest";
import {
  STORE_SCOPES,
  getStoreScope,
  scopeForLocationName,
  scopeForShopifyStoreIds,
} from "@/lib/store-scopes";

describe("getStoreScope", () => {
  it("resolves known slugs case-insensitively", () => {
    expect(getStoreScope("toronto")?.label).toBe("Toronto");
    expect(getStoreScope("Montreal")?.label).toBe("Montreal");
  });

  it("returns null for unknown slugs", () => {
    expect(getStoreScope("ottawa")).toBeNull();
    expect(getStoreScope("")).toBeNull();
  });
});

describe("scope integrity", () => {
  it("maps every shopify id to exactly one scope", () => {
    const seen = new Map<string, string>();
    for (const scope of Object.values(STORE_SCOPES)) {
      for (const id of scope.shopifyStoreIds) {
        expect(seen.has(id), `${id} appears in both ${seen.get(id)} and ${scope.slug}`).toBe(false);
        seen.set(id, scope.slug);
      }
    }
    expect([...seen.keys()].sort()).toEqual(["store1", "store2", "store3"]);
  });

  it("maps every phone id to exactly one scope", () => {
    const seen = new Set<string>();
    for (const scope of Object.values(STORE_SCOPES)) {
      for (const id of scope.phoneStoreIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual(["bc_transparent", "glass_railing_store", "rf_transparent"]);
  });
});

describe("scopeForShopifyStoreIds", () => {
  it("finds the scope for a location's store ids", () => {
    expect(scopeForShopifyStoreIds(["store1", "store2"])?.slug).toBe("toronto");
    expect(scopeForShopifyStoreIds(["store3"])?.slug).toBe("montreal");
  });

  it("returns null when nothing overlaps", () => {
    expect(scopeForShopifyStoreIds([])).toBeNull();
    expect(scopeForShopifyStoreIds(["store9"])).toBeNull();
  });
});

describe("scopeForLocationName", () => {
  it("matches location names loosely", () => {
    expect(scopeForLocationName("Toronto")?.slug).toBe("toronto");
    expect(scopeForLocationName(" montreal ")?.slug).toBe("montreal");
  });

  it("returns null for unknown locations", () => {
    expect(scopeForLocationName("Head Office")).toBeNull();
  });
});
