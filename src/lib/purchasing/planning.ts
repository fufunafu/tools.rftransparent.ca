import { addDays, addMonths, consumptionBetween, dailyDemand, pickSeasonality, purchasingToday, type SeasonalityConfig } from "./seasonality";
import type { ForecastPoint, InventoryForecast, ProductWithMetrics, PurchasingSettings } from "./types";

export interface PlannedArrival { product_id: string; date: string | null; qty: number; po_number: string }
export type StockProduct = Pick<ProductWithMetrics, "id" | "category" | "sku" | "name" | "height" | "width" | "weight" | "storage_capacity" | "unit_cost_landed" | "current_inventory" | "avg_monthly_sales_grs" | "avg_monthly_sales_rf" | "active" | "sort_order">;
const EPSILON = 1e-8;
const DAY_MS = 86_400_000;
const HORIZON = 365;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Whole crates, or one half-crate for a small requirement. Never round below demand. */
export function roundRequiredQuantity(units: number, crate: number): number {
  if (units <= EPSILON) return 0;
  if (crate <= 0) throw new Error("Crate size must be greater than zero");
  const halfCrate = Math.ceil(crate / 2);
  return units <= halfCrate + EPSILON ? halfCrate : Math.ceil((units - EPSILON) / crate) * crate;
}

export function buildForecast(productId: string, startInventory: number, baseMonthly: number, arrivals: PlannedArrival[], seasonality: SeasonalityConfig, start = purchasingToday()): InventoryForecast {
  const byDate = new Map<string, PlannedArrival[]>();
  for (const a of arrivals) {
    if (!a.date || a.date < start || a.qty <= 0) continue;
    byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  }
  const timeline: ForecastPoint[] = [{ date: start, inventory: Math.max(0, startInventory), event: "today" }];
  let stock = Math.max(0, startInventory);
  let stockout: string | null = null;
  for (let day = 0; day < HORIZON; day++) {
    const date = addDays(start, day);
    const incoming = byDate.get(date) ?? [];
    if (incoming.length && day > 0) timeline.push({ date, inventory: stock });
    stock += incoming.reduce((sum, a) => sum + a.qty, 0);
    for (const a of incoming) timeline.push({ date, inventory: stock, event: "arrival", po_number: a.po_number, qty: a.qty });
    const demand = dailyDemand(date, baseMonthly, seasonality);
    const beforeDemand = stock;
    stock = Math.max(0, stock - demand);
    if (stock <= EPSILON && demand > EPSILON && (stockout === null || beforeDemand > EPSILON)) {
      const firstStockout = stockout === null;
      if (firstStockout) stockout = date;
      // Place depletion at its actual position within the day. Every later
      // depletion needs an anchor too, otherwise the line slopes through days
      // when stock is already zero after a partial replenishment.
      timeline.push({ date, timestamp: Date.parse(`${date}T00:00:00Z`) + Math.min(1, beforeDemand / demand) * DAY_MS,
        inventory: 0, ...(firstStockout ? { event: "stockout" as const } : {}) });
    }
    // Demand has a constant daily rate inside each calendar month. These
    // anchors retain that exact slope and each arrival without a second model.
    const nextDate = addDays(date, 1);
    if (nextDate.slice(0, 7) !== date.slice(0, 7) || day === HORIZON - 1) {
      timeline.push({ date: nextDate, inventory: stock, ...(day === HORIZON - 1 ? { event: "horizon" as const } : {}) });
    }
  }
  return { product_id: productId, days_until_stockout: stockout ? daysBetween(start, stockout) : null, projected_stockout_date: stockout, timeline };
}

/** One dated model for warnings, quantities, stock coverage and the chart. */
export function planProduct(product: StockProduct, settings: PurchasingSettings, arrivals: PlannedArrival[], start = purchasingToday()): { product: ProductWithMetrics; forecast: InventoryForecast } {
  const config = pickSeasonality(settings);
  const base = product.avg_monthly_sales_grs + product.avg_monthly_sales_rf;
  const lead = Math.max(0, Math.ceil(settings.lead_time_days));
  const eta = addDays(start, lead);
  const scheduled = arrivals.filter(a => a.qty > 0 && a.date && a.date >= start).sort((a, b) => a.date!.localeCompare(b.date!));
  const unconfirmed = arrivals.filter(a => a.qty > 0 && (!a.date || a.date < start));
  const demand = (from: string, to: string) => consumptionBetween(from, to, base, config);
  const leadDemand = demand(start, eta);
  const coverDays = lead * Math.max(0, settings.restock_cover_pct) / 100;
  const wholeCoverDays = Math.floor(coverDays);
  const coverDate = addDays(eta, wholeCoverDays);
  const coverDemand = demand(eta, coverDate) + (coverDays - wholeCoverDays) * dailyDemand(coverDate, base, config);
  const capacity = product.category === "hardware" ? Math.max(50, demand(eta, addMonths(eta, 3))) : Math.max(0, product.storage_capacity);
  const target = product.category === "hardware" ? capacity : Math.min(capacity, Math.max(settings.expected_fill * capacity, coverDemand));
  // The target is an order-up-to inventory position: stock plus dated supply
  // must cover lead-time demand and the target demand after that date.
  // Later supply cannot hide an earlier shortage, even if total inbound is large.
  let arrived = 0;
  let bridge = 0;
  for (const a of scheduled) {
    if (a.date! >= eta) break;
    bridge = Math.max(bridge, demand(start, a.date!) - product.current_inventory - arrived);
    arrived += a.qty;
  }
  bridge = Math.max(bridge, leadDemand - product.current_inventory - arrived, 0);
  const transfer = Math.ceil(Math.max(0, bridge - EPSILON));
  let futureArrived = arrived;
  let china = 0;
  const positiveDemand = config.growth_factor > 0 && base > 0;
  for (const a of scheduled) {
    if (a.date! < eta) continue;
    const afterArrivalDemand = demand(eta, a.date!);
    // A supply arriving after the protected coverage window cannot offset it.
    if (positiveDemand ? afterArrivalDemand >= target - EPSILON && a.date! > eta : a.date! > eta) continue;
    china = Math.max(china, leadDemand + afterArrivalDemand - product.current_inventory - transfer - futureArrived);
    futureArrived += a.qty;
  }
  china = Math.max(0, china, leadDemand + target - product.current_inventory - transfer - futureArrived);
  if (china < EPSILON) china = 0;
  const suggested = product.category === "hardware" ? Math.ceil(china - EPSILON) : roundRequiredQuantity(china, settings.crate_size);
  const forecast = buildForecast(product.id, product.current_inventory, base, scheduled, config, start);
  const onHand = buildForecast(product.id, product.current_inventory, base, [], config, start);
  const excess = product.category === "hardware" ? 0 : Math.max(0, product.current_inventory - capacity);
  const excessForecast = excess > 0 ? buildForecast(product.id, excess, base, [], config, start) : null;
  const inbound = arrivals.reduce((sum, a) => sum + Math.max(0, a.qty), 0);
  const hasReorder = suggested > 0;
  const hasTransfer = transfer > 0;
  return { forecast, product: {
    ...product, storage_capacity: capacity, inbound, total_inventory: product.current_inventory + inbound,
    daily_sales: dailyDemand(start, base, config), days_of_stock_left: onHand.days_until_stockout,
    days_of_stock_with_inbound: forecast.days_until_stockout, days_until_next_arrival: scheduled.length ? daysBetween(start, scheduled[0].date!) : null,
    reorder_point: leadDemand + target, restock_target: target, perfect_qty: china, suggested_qty: Math.max(0, suggested), transfer_requirement: transfer,
    inventory_value: product.current_inventory * product.unit_cost_landed, overstock: excess,
    sop_label: hasReorder && hasTransfer ? "reorder_plus_montreal" : hasTransfer ? "montreal_transfer" : hasReorder ? "reorder" : base <= 0 ? "no_sales_data" : "ok",
    planning: { as_of: start, order_arrival_date: eta, lead_demand: leadDemand, target_demand: target, cover_demand: coverDemand, counted_inbound: futureArrived,
      unconfirmed_inbound: unconfirmed.reduce((sum, a) => sum + a.qty, 0), unconfirmed_orders: [...new Set(unconfirmed.map(a => a.po_number))],
      projected_stockout_date: forecast.projected_stockout_date, on_hand_stockout_date: onHand.projected_stockout_date,
      days_until_capacity: excess <= 0 ? 0 : excessForecast?.days_until_stockout ?? null },
  } };
}
