import { describe, it, expect, vi } from "vitest";

// buildForecast is pure; mock the module's server-only imports so importing
// the file never touches Next.js caching or a real Supabase client.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: vi.fn(() => {
    throw new Error("getSupabase should not be called in these tests");
  }),
}));
vi.mock("@/lib/purchasing/queries", () => ({
  getPurchasingSettings: vi.fn(),
}));

import { buildForecast } from "@/lib/purchasing/forecast";
import type { SeasonalityConfig } from "@/lib/purchasing/seasonality";

const flat: SeasonalityConfig = {
  season_multipliers: Array(12).fill(1),
  growth_factor: 1,
};

const START = "2026-01-01";

function arrival(date: string, qty: number, po = "PO-1") {
  return { product_id: "p1", date, qty, po_number: po };
}

describe("buildForecast", () => {
  it("steady demand: stocks out when cumulative consumption reaches inventory", () => {
    // 100 units, 30/month = 1/day. Consumption starts on the start day itself,
    // so inventory hits 0 at the end of day index 99 → 2026-04-10.
    const f = buildForecast("p1", 100, 30, [], flat, START);

    expect(f.product_id).toBe("p1");
    expect(f.days_until_stockout).toBe(99);
    expect(f.projected_stockout_date).toBe("2026-04-10");

    expect(f.timeline[0]).toEqual({ date: START, inventory: 100, event: "today" });
    const stockout = f.timeline.find((p) => p.event === "stockout")!;
    expect(stockout).toEqual({ date: "2026-04-10", inventory: 0, event: "stockout" });
    // Horizon anchor is always last, one year out, clamped to 0
    const last = f.timeline[f.timeline.length - 1];
    expect(last.event).toBe("horizon");
    expect(last.date).toBe("2027-01-01");
    expect(last.inventory).toBe(0);
  });

  it("zero demand: never stocks out, horizon keeps starting inventory", () => {
    const f = buildForecast("p1", 50, 0, [], flat, START);

    expect(f.days_until_stockout).toBeNull();
    expect(f.projected_stockout_date).toBeNull();
    expect(f.timeline).toEqual([
      { date: START, inventory: 50, event: "today" },
      { date: "2027-01-01", inventory: 50, event: "horizon" },
    ]);
  });

  it("no stockout within the horizon when inventory outlasts demand", () => {
    const f = buildForecast("p1", 10_000, 30, [], flat, START);

    expect(f.days_until_stockout).toBeNull();
    expect(f.projected_stockout_date).toBeNull();
    const last = f.timeline[f.timeline.length - 1];
    expect(last.event).toBe("horizon");
    expect(last.inventory).toBeCloseTo(10_000 - 365, 6); // 365 days at 1/day
  });

  it("an arrival extends the runway and appears as a timeline event", () => {
    // 10 units at 1/day; +100 arrive on day 5 (2026-01-06).
    const f = buildForecast("p1", 10, 30, [arrival("2026-01-06", 100, "PO-7")], flat, START);

    const arr = f.timeline.find((p) => p.event === "arrival")!;
    expect(arr.date).toBe("2026-01-06");
    expect(arr.po_number).toBe("PO-7");
    expect(arr.qty).toBe(100);
    // 10 - 5 consumed before the arrival, then +100 (arrival lands before that day's demand)
    expect(arr.inventory).toBeCloseTo(105, 6);

    // 110 total units at 1/day → stockout at end of day 109
    expect(f.days_until_stockout).toBe(109);
    expect(f.projected_stockout_date).toBe("2026-04-20");
  });

  it("ignores arrivals dated before the start", () => {
    const f = buildForecast("p1", 100, 30, [arrival("2025-12-31", 500)], flat, START);

    expect(f.timeline.some((p) => p.event === "arrival")).toBe(false);
    expect(f.days_until_stockout).toBe(99); // same as no-arrival case
  });

  it("keeps the first stockout date even when a later arrival refills", () => {
    // 5 units at 1/day → stockout at end of day 4 (2026-01-05); refill on Jan 20.
    const f = buildForecast("p1", 5, 30, [arrival("2026-01-20", 100)], flat, START);

    expect(f.days_until_stockout).toBe(4);
    expect(f.projected_stockout_date).toBe("2026-01-05");
    // Only one stockout event even though inventory dips below zero again later
    expect(f.timeline.filter((p) => p.event === "stockout")).toHaveLength(1);
    // The arrival still shows on the post-stockout trajectory
    expect(f.timeline.some((p) => p.event === "arrival" && p.date === "2026-01-20")).toBe(true);
  });

  it("emits one timeline point per arrival when several land the same day", () => {
    const f = buildForecast(
      "p1",
      10,
      30,
      [arrival("2026-01-06", 20, "PO-A"), arrival("2026-01-06", 30, "PO-B")],
      flat,
      START,
    );

    const arrs = f.timeline.filter((p) => p.event === "arrival");
    expect(arrs).toHaveLength(2);
    expect(arrs.map((a) => a.po_number).sort()).toEqual(["PO-A", "PO-B"]);
    // Both points report the inventory after ALL of that day's arrivals landed
    expect(arrs[0].inventory).toBeCloseTo(55, 6); // 10 - 5 + 20 + 30
    expect(arrs[1].inventory).toBeCloseTo(55, 6);
  });

  it("applies the month's seasonality multiplier to daily consumption", () => {
    const janDouble: SeasonalityConfig = {
      season_multipliers: [2, ...Array(11).fill(1)],
      growth_factor: 1,
    };
    // 10 units, base 1/day but ×2 in January → 5 days of runway
    const f = buildForecast("p1", 10, 30, [], janDouble, START);

    expect(f.days_until_stockout).toBe(4); // 0 at the end of day index 4
    expect(f.projected_stockout_date).toBe("2026-01-05");
  });

  it("applies the growth factor on top of seasonality", () => {
    const grown: SeasonalityConfig = {
      season_multipliers: Array(12).fill(1),
      growth_factor: 1.5,
    };
    // 9 units at 1.5/day → 0 at the end of day index 5 → 2026-01-06
    const f = buildForecast("p1", 9, 30, [], grown, START);

    expect(f.days_until_stockout).toBe(5);
    expect(f.projected_stockout_date).toBe("2026-01-06");
  });
});
