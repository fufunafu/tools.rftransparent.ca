import { expect, it } from "vitest";
import { seasonalMonthlySales } from "./seasonality";
it("shows yearly units divided by 12, then multiplied by the current month's seasonality exactly once", () => {
  const settings = { season_multipliers: [0.5,0.6,0.8,1,1.5,1.8,1.7,1.4,1.1,0.9,0.5,0.2], annual_growth_pct: 25 };
  expect(seasonalMonthlySales(1200 / 12, settings, new Date("2026-07-15T12:00:00Z"))).toBe(170);
  expect(seasonalMonthlySales(1200 / 12, settings, new Date("2026-10-01T02:00:00Z"))).toBeCloseTo(110);
});
