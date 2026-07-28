import { describe, it, expect } from "vitest";
import {
  pickSeasonality,
  monthMultiplier,
  consumptionBetween,
  type SeasonalityConfig,
} from "@/lib/purchasing/seasonality";
import type { PurchasingSettings } from "@/lib/purchasing/types";

function settings(overrides: Partial<PurchasingSettings> = {}): PurchasingSettings {
  return {
    expected_fill: 0.9,
    lead_time_days: 60,
    crate_size: 20,
    season_multipliers: Array(12).fill(1),
    annual_growth_pct: 0,
    restock_cover_pct: 100,
    ...overrides,
  };
}

const flat: SeasonalityConfig = {
  season_multipliers: Array(12).fill(1),
  growth_factor: 1,
};

// ─── pickSeasonality ────────────────────────────────────────────────────────

describe("pickSeasonality", () => {
  it("converts annual growth percent into a growth factor", () => {
    expect(pickSeasonality(settings({ annual_growth_pct: 10 })).growth_factor).toBeCloseTo(1.1, 10);
    expect(pickSeasonality(settings({ annual_growth_pct: 0 })).growth_factor).toBe(1);
    expect(pickSeasonality(settings({ annual_growth_pct: -20 })).growth_factor).toBeCloseTo(0.8, 10);
  });

  it("defaults growth to 1 when annual_growth_pct is missing", () => {
    const s = settings();
    // Simulate a pre-migration row where the column is null
    (s as unknown as Record<string, unknown>).annual_growth_pct = null;
    expect(pickSeasonality(s).growth_factor).toBe(1);
  });

  it("passes season multipliers through untouched", () => {
    const mult = [1, 0.5, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(pickSeasonality(settings({ season_multipliers: mult })).season_multipliers).toBe(mult);
  });
});

// ─── monthMultiplier ────────────────────────────────────────────────────────

describe("monthMultiplier", () => {
  it("returns the month's multiplier times the growth factor", () => {
    const s: SeasonalityConfig = {
      season_multipliers: [2, 0.5, ...Array(10).fill(1)],
      growth_factor: 1.1,
    };
    expect(monthMultiplier(0, s)).toBeCloseTo(2.2, 10); // January
    expect(monthMultiplier(1, s)).toBeCloseTo(0.55, 10); // February
    expect(monthMultiplier(5, s)).toBeCloseTo(1.1, 10); // June (default 1)
  });

  it("treats zero, negative, and NaN multipliers as 1", () => {
    const s: SeasonalityConfig = {
      season_multipliers: [0, -3, NaN, ...Array(9).fill(1)],
      growth_factor: 1,
    };
    expect(monthMultiplier(0, s)).toBe(1);
    expect(monthMultiplier(1, s)).toBe(1);
    expect(monthMultiplier(2, s)).toBe(1);
  });

  it("treats a missing month entry (short array) as 1", () => {
    const s: SeasonalityConfig = { season_multipliers: [], growth_factor: 1 };
    expect(monthMultiplier(11, s)).toBe(1);
  });

  it("treats an invalid growth factor as 1", () => {
    const base = [2, ...Array(11).fill(1)];
    expect(monthMultiplier(0, { season_multipliers: base, growth_factor: NaN })).toBe(2);
    expect(monthMultiplier(0, { season_multipliers: base, growth_factor: 0 })).toBe(2);
    expect(monthMultiplier(0, { season_multipliers: base, growth_factor: -1 })).toBe(2);
  });
});

// ─── consumptionBetween ─────────────────────────────────────────────────────

describe("consumptionBetween", () => {
  it("returns 0 for zero or negative demand", () => {
    expect(consumptionBetween("2026-01-01", "2026-02-01", 0, flat)).toBe(0);
    expect(consumptionBetween("2026-01-01", "2026-02-01", -5, flat)).toBe(0);
  });

  it("returns 0 for an empty or inverted range", () => {
    expect(consumptionBetween("2026-01-10", "2026-01-10", 30, flat)).toBe(0);
    expect(consumptionBetween("2026-02-01", "2026-01-01", 30, flat)).toBe(0);
  });

  it("consumes baseMonthly/30 per day over a flat range (end exclusive)", () => {
    // 10 days at 1 unit/day
    expect(consumptionBetween("2026-01-01", "2026-01-11", 30, flat)).toBeCloseTo(10, 10);
    // A single day
    expect(consumptionBetween("2026-01-01", "2026-01-02", 30, flat)).toBeCloseTo(1, 10);
  });

  it("applies each calendar month's own multiplier across a boundary", () => {
    const s: SeasonalityConfig = {
      season_multipliers: [2, 1, ...Array(10).fill(1)], // Jan ×2, Feb ×1
      growth_factor: 1,
    };
    // Days consumed: Jan 30, Jan 31 (×2 each) + Feb 1 (×1) at 1 unit/day base
    expect(consumptionBetween("2026-01-30", "2026-02-02", 30, s)).toBeCloseTo(5, 10);
  });

  it("applies the growth factor uniformly", () => {
    const s: SeasonalityConfig = { season_multipliers: Array(12).fill(1), growth_factor: 1.5 };
    expect(consumptionBetween("2026-01-01", "2026-01-11", 30, s)).toBeCloseTo(15, 10);
  });

  it("covers a full non-leap year proportionally", () => {
    // 365 days at 1 unit/day
    expect(consumptionBetween("2026-01-01", "2027-01-01", 30, flat)).toBeCloseTo(365, 8);
  });
});
