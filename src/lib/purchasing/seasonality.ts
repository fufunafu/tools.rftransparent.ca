// Calendar demand shared by purchasing recommendations and stock forecasts.

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
  const growth = Number.isFinite(s.growth_factor) && s.growth_factor >= 0 ? s.growth_factor : 1;
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
  let total = 0;
  while (cur < end) {
    total += dailyDemand(new Date(cur).toISOString().slice(0, 10), baseMonthly, s);
    cur += DAY_MS;
  }
  return total;
}

// The displayed monthly demand is annual units / 12 multiplied by seasonality.
// Growth remains a separate planning assumption in the stock forecast.
export function currentSeasonMultiplier(settings: Pick<PurchasingSettings, "season_multipliers">, date = new Date()): number {
  const month = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "numeric" }).format(date)) - 1;
  const value = Number(settings.season_multipliers[month]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
export function seasonalMonthlySales(baseMonthly: number, settings: Pick<PurchasingSettings, "season_multipliers">, date = new Date()): number {
  return baseMonthly * currentSeasonMultiplier(settings, date);
}

export function purchasingToday(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, last));
  return value.toISOString().slice(0, 10);
}

export function dailyDemand(date: string, baseMonthly: number, config: SeasonalityConfig): number {
  const value = new Date(`${date}T00:00:00Z`);
  const month = value.getUTCMonth();
  const days = new Date(Date.UTC(value.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Math.max(0, baseMonthly) / days * monthMultiplier(month, config);
}
