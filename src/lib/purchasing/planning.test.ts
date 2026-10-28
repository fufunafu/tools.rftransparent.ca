import { describe, expect, it } from "vitest";
import { planProduct, roundRequiredQuantity, type PlannedArrival, type StockProduct } from "./planning";
import { consumptionBetween, pickSeasonality } from "./seasonality";
import type { PurchasingSettings } from "./types";
const settings: PurchasingSettings = { expected_fill: 0.5, lead_time_days: 10, crate_size: 1, season_multipliers: Array(12).fill(1), annual_growth_pct: 0, restock_cover_pct: 0 };
const product: StockProduct = { id: "p", sku: "PANEL-TEST", name: "Test panel", category: "glass", height: 40, width: 50, weight: null, storage_capacity: 20, current_inventory: 12, avg_monthly_sales_rf: 31, avg_monthly_sales_grs: 0, unit_cost_landed: 1, active: true, sort_order: 0 };
const arrival = (date: string | null, qty: number): PlannedArrival => ({ product_id: "p", date, qty, po_number: "TEST-PO" });
const start = "2026-01-01";

describe("calendar purchasing planning", () => {
  it("does not request a winter transfer based on an autumn rate held constant", () => {
    const config = { ...settings, lead_time_days: 70, crate_size: 20, season_multipliers: [0.3,0.3,0.5,1,1.2,1.5,1.5,1.4,1.1,1.5,0.7,0.4] };
    const plan = planProduct({ ...product, current_inventory: 100, storage_capacity: 120, avg_monthly_sales_rf: 40 }, config, [arrival("2027-01-10", 50)], "2026-10-27");
    expect(plan.product.transfer_requirement).toBe(0);
    expect(plan.product.suggested_qty).toBe(0);
    expect(plan.product.sop_label).toBe("ok");
    expect(plan.forecast.projected_stockout_date! > "2027-01-10").toBe(true);
    expect(plan.product.days_of_stock_with_inbound).toBe(plan.forecast.days_until_stockout);
  });
  it("counts every dated arrival and detects a shortage after a small first shipment", () => {
    const plan = planProduct({ ...product, current_inventory: 5 }, { ...settings, lead_time_days: 30 }, [arrival("2026-01-03", 2), arrival("2026-01-31", 100)], start);
    expect(plan.product.transfer_requirement).toBe(23);
    expect(plan.product.suggested_qty).toBe(0);
    expect(plan.product.sop_label).toBe("montreal_transfer");
  });
  it("does not let a shipment beyond the coverage window hide a required supplier order", () => {
    const plan = planProduct(product, settings, [arrival("2026-05-01", 1000)], start);
    expect(plan.product.transfer_requirement).toBe(0);
    expect(plan.product.perfect_qty).toBeCloseTo(8);
    expect(plan.product.suggested_qty).toBe(8);
    expect(plan.product.planning!.counted_inbound).toBe(0);
  });
  it("requires enough stock to bridge a later arrival even if total incoming stock is large", () => {
    const plan = planProduct(product, settings, [arrival("2026-01-15", 100)], start);
    expect(plan.product.perfect_qty).toBeCloseTo(2);
    expect(plan.product.suggested_qty).toBe(2);
    expect(plan.product.transfer_requirement).toBe(0);
  });
  it("does not order the emergency transfer units a second time from the supplier", () => {
    const plan = planProduct({ ...product, current_inventory: 0, storage_capacity: 40 }, settings, [], start);
    expect(plan.product.transfer_requirement).toBe(10);
    expect(plan.product.perfect_qty).toBeCloseTo(20);
    expect(plan.product.sop_label).toBe("reorder_plus_montreal");
  });
  it("uses supply on its ETA before that day's demand", () => {
    const plan = planProduct({ ...product, current_inventory: 10 }, settings, [arrival("2026-01-11", 10)], start);
    expect(plan.product.transfer_requirement).toBe(0);
    expect(plan.product.suggested_qty).toBe(0);
  });
  it("does not assume overdue or undated shipments arrive today", () => {
    const plan = planProduct(product, settings, [arrival("2025-12-20", 50), arrival(null, 40)], start);
    expect(plan.product.inbound).toBe(90);
    expect(plan.product.planning!.unconfirmed_inbound).toBe(90);
    expect(plan.product.planning!.counted_inbound).toBe(0);
    expect(plan.product.suggested_qty).toBe(8);
    expect(plan.forecast.timeline.some(point => point.event === "arrival")).toBe(false);
  });
  it("bases post-arrival coverage on the season after arrival, not the current season", () => {
    const config = { ...settings, lead_time_days: 31, restock_cover_pct: 100, season_multipliers: [0.2,2,...Array(10).fill(1)] };
    const plan = planProduct({ ...product, storage_capacity: 1000, current_inventory: 1000 }, { ...config, expected_fill: 0 }, [], start);
    expect(plan.product.planning!.lead_demand).toBeCloseTo(6.2);
    expect(plan.product.restock_target).toBeCloseTo(consumptionBetween("2026-02-01", "2026-03-04", 31, pickSeasonality(config)));
    expect(plan.product.restock_target).toBeGreaterThan(60);
  });
  it("honors zero forecast growth factor without inventing demand", () => {
    const plan = planProduct({ ...product, current_inventory: 10 }, { ...settings, annual_growth_pct: -100 }, [], start);
    expect(plan.product.daily_sales).toBe(0);
    expect(plan.product.transfer_requirement).toBe(0);
    expect(plan.forecast.projected_stockout_date).toBeNull();
  });
  it("keeps the minimum-stock target explicit when the sales baseline is zero", () => {
    const plan = planProduct({ ...product, category: "hardware", current_inventory: 5, avg_monthly_sales_rf: 0 }, settings, [], start);
    expect(plan.product.restock_target).toBe(50);
    expect(plan.product.suggested_qty).toBe(45);
    expect(plan.product.transfer_requirement).toBe(0);
    expect(plan.product.sop_label).toBe("reorder");
  });
});

it("never rounds a supplier recommendation below its calculated requirement", () => {
  expect(roundRequiredQuantity(16, 35)).toBe(18);
  expect(roundRequiredQuantity(20, 35)).toBe(35);
  expect(roundRequiredQuantity(40, 35)).toBe(70);
  for (let units = 1; units < 300; units += 0.5) expect(roundRequiredQuantity(units, 35)).toBeGreaterThanOrEqual(units);
});
