import { describe, expect, it } from "vitest";
import {
  defaultLeadStoreForRegion,
  isLeadStoreId,
  leadStoreForShopifyShop,
} from "@/lib/customer-service/lead-store";

const env = {
  SHOPIFY_STORE_1: "rf-one.myshopify.com",
  SHOPIFY_STORE_2: "https://rf-two.myshopify.com/",
  SHOPIFY_STORE_3: "bc-store.myshopify.com",
};

describe("leadStoreForShopifyShop", () => {
  it("maps the RF shops to rf_transparent", () => {
    expect(leadStoreForShopifyShop("rf-one.myshopify.com", env)).toBe("rf_transparent");
    expect(leadStoreForShopifyShop("RF-TWO.myshopify.com", env)).toBe("rf_transparent");
  });

  it("maps the third slot (Montreal) to bc_transparent", () => {
    expect(leadStoreForShopifyShop("bc-store.myshopify.com", env)).toBe("bc_transparent");
  });

  it("falls back to RF for unknown or missing shops", () => {
    expect(leadStoreForShopifyShop("someone-else.myshopify.com", env)).toBe("rf_transparent");
    expect(leadStoreForShopifyShop(null, env)).toBe("rf_transparent");
  });
});

describe("store helpers", () => {
  it("defaults Quebec visitors to BC", () => {
    expect(defaultLeadStoreForRegion("QC")).toBe("bc_transparent");
    expect(defaultLeadStoreForRegion("ON")).toBe("rf_transparent");
    expect(defaultLeadStoreForRegion(null)).toBe("rf_transparent");
  });

  it("validates store ids", () => {
    expect(isLeadStoreId("bc_transparent")).toBe(true);
    expect(isLeadStoreId("store3")).toBe(false);
  });
});
