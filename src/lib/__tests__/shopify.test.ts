import { describe, it, expect } from "vitest";
import { calcNetRevenue, type RevenueFields } from "@/lib/shopify";

describe("calcNetRevenue", () => {
  it("calculates subtotal minus shipping and tariff", () => {
    const order: RevenueFields = {
      subtotalPriceSet: { shopMoney: { amount: "500.00" } },
      shippingCostMeta: { value: "25.00" },
      exportTariffMeta: { value: "10.00" },
    };
    expect(calcNetRevenue(order)).toBe(465);
  });

  it("handles null metafields (no shipping/tariff)", () => {
    const order: RevenueFields = {
      subtotalPriceSet: { shopMoney: { amount: "200.00" } },
      shippingCostMeta: null,
      exportTariffMeta: null,
    };
    expect(calcNetRevenue(order)).toBe(200);
  });

  it("handles partial metafields (only shipping)", () => {
    const order: RevenueFields = {
      subtotalPriceSet: { shopMoney: { amount: "100.00" } },
      shippingCostMeta: { value: "15.50" },
      exportTariffMeta: null,
    };
    expect(calcNetRevenue(order)).toBe(84.5);
  });

  it("handles zero subtotal", () => {
    const order: RevenueFields = {
      subtotalPriceSet: { shopMoney: { amount: "0" } },
      shippingCostMeta: null,
      exportTariffMeta: null,
    };
    expect(calcNetRevenue(order)).toBe(0);
  });

  it("handles non-numeric metafield values gracefully (NaN → 0)", () => {
    const order: RevenueFields = {
      subtotalPriceSet: { shopMoney: { amount: "100.00" } },
      shippingCostMeta: { value: "not-a-number" },
      exportTariffMeta: { value: "" },
    };
    // parseFloat("not-a-number") → NaN, || 0 → 0
    // parseFloat("") → NaN, || 0 → 0
    expect(calcNetRevenue(order)).toBe(100);
  });
});
