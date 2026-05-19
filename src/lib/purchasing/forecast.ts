import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getPurchasingSettings } from "./queries";
import {
  monthMultiplier,
  pickSeasonality,
  type SeasonalityConfig,
} from "./seasonality";
import type { ForecastPoint, InventoryForecast } from "./types";

const TAG = "purchasing";
const REVALIDATE = 60;
const HORIZON_DAYS = 365;
const DAY_MS = 86_400_000;

const num = (x: unknown): number => {
  if (x === null || x === undefined) return 0;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
};

interface Arrival {
  product_id: string;
  date: string;
  qty: number;
  po_number: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ad = new Date(a + "T00:00:00Z").getTime();
  const bd = new Date(b + "T00:00:00Z").getTime();
  return Math.round((bd - ad) / 86_400_000);
}

function addDaysISO(base: string, days: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Day-by-day simulation so each calendar month uses its own seasonality
// multiplier. Emits an event-anchor point at: start, every arrival, the
// stockout day (if any), and the horizon (if no stockout). Keeps the
// timeline sparse — the client densifier handles the visual line.
export function buildForecast(
  productId: string,
  startInventory: number,
  baseMonthly: number,
  arrivals: Arrival[],
  seasonality: SeasonalityConfig,
  start: string = todayISO(),
): InventoryForecast {
  const horizon = addDaysISO(start, HORIZON_DAYS);
  const arrByDate = new Map<string, Arrival[]>();
  for (const a of arrivals) {
    if (a.date < start) continue;
    const arr = arrByDate.get(a.date) ?? [];
    arr.push(a);
    arrByDate.set(a.date, arr);
  }

  const timeline: ForecastPoint[] = [
    { date: start, inventory: startInventory, event: "today" },
  ];

  const dailyBase = baseMonthly / 30;
  let cur = startInventory;
  let cursorMs = new Date(start + "T00:00:00Z").getTime();
  const horizonMs = new Date(horizon + "T00:00:00Z").getTime();
  let stockoutDate: string | null = null;

  while (cursorMs < horizonMs) {
    const dateISO = isoFromMs(cursorMs);
    // Arrivals land at the start of their ETA day.
    const arrs = arrByDate.get(dateISO);
    if (arrs) {
      for (const a of arrs) cur += a.qty;
      for (const a of arrs) {
        timeline.push({
          date: dateISO,
          inventory: cur,
          event: "arrival",
          po_number: a.po_number,
          qty: a.qty,
        });
      }
    }
    if (dailyBase > 0) {
      const monthIdx = new Date(cursorMs).getUTCMonth();
      cur -= dailyBase * monthMultiplier(monthIdx, seasonality);
    }
    if (stockoutDate === null && cur <= 0 && dailyBase > 0) {
      stockoutDate = dateISO;
      timeline.push({ date: dateISO, inventory: 0, event: "stockout" });
    }
    cursorMs += DAY_MS;
  }

  // Always emit a horizon anchor so the chart shows the full year
  // window — including the post-stockout trajectory when late arrivals
  // refill and then deplete again. The client densifier interpolates
  // between this point and the last event using seasonality math.
  timeline.push({
    date: horizon,
    inventory: Math.max(0, cur),
    event: "horizon",
  });

  return {
    product_id: productId,
    days_until_stockout: stockoutDate ? daysBetween(start, stockoutDate) : null,
    projected_stockout_date: stockoutDate,
    timeline,
  };
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function getInventoryForecasts(): Promise<
  Record<string, InventoryForecast>
> {
  return unstable_cache(
    async () => {
      const supabase = getSupabase();
      const settings = await getPurchasingSettings();
      const seasonality = pickSeasonality(settings);
      // Pull the *raw* monthly average — the view's daily_sales is already
      // scaled by the current month, but the forecast needs the unscaled
      // base so it can apply each future month's own multiplier.
      const { data: prods, error: prodErr } = await supabase
        .from("purchasing_reorder_view")
        .select(
          "id, current_inventory, avg_monthly_sales_grs, avg_monthly_sales_rf",
        );
      if (prodErr) throw new Error(prodErr.message);

      const { data: items, error: itemsErr } = await supabase
        .from("purchasing_order_items")
        .select(
          "product_id, qty_ordered, qty_received, purchasing_orders!inner(po_number, status, eta_date)",
        )
        .in("purchasing_orders.status", ["ordered", "in_transit"])
        .not("purchasing_orders.eta_date", "is", null);
      if (itemsErr) throw new Error(itemsErr.message);

      const start = todayISO();
      const byProduct = new Map<string, Arrival[]>();
      for (const r of (items ?? []) as Array<Record<string, unknown>>) {
        const order = r.purchasing_orders as
          | { po_number: string; status: string; eta_date: string }
          | { po_number: string; status: string; eta_date: string }[]
          | null;
        const po = Array.isArray(order) ? order[0] : order;
        if (!po?.eta_date) continue;
        const remaining = num(r.qty_ordered) - num(r.qty_received);
        if (remaining <= 0) continue;
        const pid = String(r.product_id);
        const eta = po.eta_date < start ? start : po.eta_date;
        const arr = byProduct.get(pid) ?? [];
        arr.push({
          product_id: pid,
          date: eta,
          qty: remaining,
          po_number: po.po_number,
        });
        byProduct.set(pid, arr);
      }

      const result: Record<string, InventoryForecast> = {};
      for (const p of (prods ?? []) as Array<{
        id: string;
        current_inventory: number | string;
        avg_monthly_sales_grs: number | string;
        avg_monthly_sales_rf: number | string;
      }>) {
        const pid = String(p.id);
        const baseMonthly =
          num(p.avg_monthly_sales_grs) + num(p.avg_monthly_sales_rf);
        result[pid] = buildForecast(
          pid,
          num(p.current_inventory),
          baseMonthly,
          byProduct.get(pid) ?? [],
          seasonality,
          start,
        );
      }
      return result;
    },
    ["purchasing:forecasts"],
    { tags: [TAG], revalidate: REVALIDATE },
  )();
}
