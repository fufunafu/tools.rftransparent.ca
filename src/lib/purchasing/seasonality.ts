// Seasonality helpers. The DB view scales `daily_sales` by the *current*
// month's multiplier so Reorder/Inventory decisions are season-aware out of
// the box. This module is for the forecast path, where we need to apply
// each calendar month's own multiplier as the projection walks forward.

import type { PurchasingSettings } from "./types";

export interface SeasonalityConfig {
  season_multipliers: number[];
  // (1 + annual_growth_pct / 100). Lifts every month uniformly on top of
  // the per-month seasonality shape.
  growth_factor: number;
}

const DAY_MS = 86_400_000;

export function pickSeasonality(s: PurchasingSettings): SeasonalityConfig {
  return {
    season_multipliers: s.season_multipliers,
    growth_factor: 1 + (s.annual_growth_pct ?? 0) / 100,
  };
}

export function monthMultiplier(
  monthIdx0: number,
  s: SeasonalityConfig,
): number {
  const m = s.season_multipliers[monthIdx0];
  const season = typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 1;
  const growth = Number.isFinite(s.growth_factor) && s.growth_factor > 0 ? s.growth_factor : 1;
  return season * growth;
}

// Units consumed in [startISO, endISO) given a 12-month-avg `baseMonthly`
// sales rate. Walks day-by-day; cheap for forecast horizons (≤ 365 days).
export function consumptionBetween(
  startISO: string,
  endISO: string,
  baseMonthly: number,
  s: SeasonalityConfig,
): number {
  if (baseMonthly <= 0 || endISO <= startISO) return 0;
  let cur = Date.UTC(
    Number(startISO.slice(0, 4)),
    Number(startISO.slice(5, 7)) - 1,
    Number(startISO.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(endISO.slice(0, 4)),
    Number(endISO.slice(5, 7)) - 1,
    Number(endISO.slice(8, 10)),
  );
  const dailyBase = baseMonthly / 30;
  let total = 0;
  while (cur < end) {
    const m = new Date(cur).getUTCMonth();
    total += dailyBase * monthMultiplier(m, s);
    cur += DAY_MS;
  }
  return total;
}
