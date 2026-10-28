import { cache } from "react";
import { planProduct, type PlannedArrival, type StockProduct } from "./planning";
import { purchasingToday } from "./seasonality";
import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import type {
  Category,
  InventoryForecast,
  OrderItemWithProduct,
  ProductWithMetrics,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderWithRollup,
  PurchasingSettings,
  PurchasingSummary,
} from "./types";

const TAG = "purchasing";
const REVALIDATE = 60;

const num = (x: unknown, fallback = 0): number => {
  if (x === null || x === undefined) return fallback;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
};

const numOrNull = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};

// React cache shares one request snapshot between the table and the forecast.
// It is not a cross-request cache, so inventory edits use fresh source rows.
export const getPurchasingPlanning = cache(async () => {
  const db = getSupabase();
  async function readProducts() {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await db.from("purchasing_products").select("*").order("sort_order").order("id").range(from, from + 999);
      if (page.error) throw new Error(page.error.message);
      rows.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < 1000) return rows;
    }
  }
  async function readArrivals() {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await db.from("purchasing_order_items")
        .select("id,product_id,qty_ordered,qty_received,purchasing_orders!inner(po_number,status,eta_date)")
        .in("purchasing_orders.status", ["ordered", "in_transit"]).order("id").range(from, from + 999);
      if (page.error) throw new Error(page.error.message);
      rows.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < 1000) return rows;
    }
  }
  const [rawProducts, rawArrivals, settings] = await Promise.all([readProducts(), readArrivals(), getPurchasingSettings()]);
  const arrivals = new Map<string, PlannedArrival[]>();
  for (const row of rawArrivals) {
    const value = row.purchasing_orders as { po_number: string; eta_date: string | null } | { po_number: string; eta_date: string | null }[];
    const order = Array.isArray(value) ? value[0] : value;
    const qty = num(row.qty_ordered) - num(row.qty_received);
    if (!row.product_id || !order || qty <= 0) continue;
    const id = String(row.product_id);
    arrivals.set(id, [...(arrivals.get(id) ?? []), { product_id: id, date: order.eta_date, qty, po_number: order.po_number }]);
  }
  const products: ProductWithMetrics[] = [];
  const forecasts: Record<string, InventoryForecast> = {};
  const start = purchasingToday();
  for (const row of rawProducts) {
    const product: StockProduct = {
      id: String(row.id), category: row.category as Category, sku: String(row.sku), name: String(row.name),
      height: numOrNull(row.height), width: numOrNull(row.width), weight: numOrNull(row.weight),
      storage_capacity: num(row.storage_capacity), unit_cost_landed: num(row.unit_cost_landed), current_inventory: num(row.current_inventory),
      avg_monthly_sales_grs: num(row.avg_monthly_sales_grs), avg_monthly_sales_rf: num(row.avg_monthly_sales_rf),
      active: Boolean(row.active), sort_order: num(row.sort_order),
    };
    const plan = planProduct(product, settings, arrivals.get(product.id) ?? [], start);
    products.push(plan.product); forecasts[product.id] = plan.forecast;
  }
  return { products, forecasts, settings };
});

export async function listProductsWithMetrics(category?: Category | null): Promise<ProductWithMetrics[]> {
  const { products } = await getPurchasingPlanning();
  return category ? products.filter(product => product.category === category) : products;
}

export function getPurchasingSummary(): Promise<PurchasingSummary> {
  return unstable_cache(
    async () => {
      const supabase = getSupabase();

      const { data: prodRows, error: prodErr } = await supabase
        .from("purchasing_products")
        .select("current_inventory, unit_cost_landed");
      if (prodErr) throw new Error(prodErr.message);

      let units_on_hand = 0;
      let total_inventory_value = 0;
      for (const r of (prodRows ?? []) as Array<Record<string, unknown>>) {
        units_on_hand += num(r.current_inventory);
        total_inventory_value += num(r.current_inventory) * num(r.unit_cost_landed);
      }

      const { data: openItems, error: openErr } = await supabase
        .from("purchasing_order_items")
        .select(
          "qty_ordered, unit_cost_snapshot, purchasing_orders!inner(status)",
        )
        .in("purchasing_orders.status", ["draft", "ordered", "in_transit"]);
      if (openErr) throw new Error(openErr.message);

      let open_po_value = 0;
      for (const r of (openItems ?? []) as Array<Record<string, unknown>>) {
        open_po_value += num(r.qty_ordered) * num(r.unit_cost_snapshot);
      }

      const monthStart = `${purchasingToday().slice(0, 7)}-01`;
      const { data: monthItems, error: monthErr } = await supabase
        .from("purchasing_order_items")
        .select(
          "qty_ordered, unit_cost_snapshot, purchasing_orders!inner(order_date, status)",
        )
        .gte(
          "purchasing_orders.order_date",
          monthStart,
        )
        .in("purchasing_orders.status", ["ordered", "in_transit", "received"]);
      if (monthErr) throw new Error(monthErr.message);

      let month_order_value = 0;
      for (const r of (monthItems ?? []) as Array<Record<string, unknown>>) {
        month_order_value += num(r.qty_ordered) * num(r.unit_cost_snapshot);
      }

      return {
        units_on_hand: Math.round(units_on_hand),
        total_inventory_value: Math.round(total_inventory_value * 100) / 100,
        open_po_value: Math.round(open_po_value * 100) / 100,
        month_order_value: Math.round(month_order_value * 100) / 100,
      };
    },
    ["purchasing:summary"],
    { tags: [TAG], revalidate: REVALIDATE },
  )();
}

export function listOrdersWithRollup(): Promise<PurchaseOrderWithRollup[]> {
  return unstable_cache(
    async () => {
      const supabase = getSupabase();
      const { data: orders, error } = await supabase
        .from("purchasing_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);

      const orderRows = (orders ?? []) as PurchaseOrder[];
      if (orderRows.length === 0) return [];

      const orderIds = orderRows.map((o) => o.id);
      const { data: items, error: itemsErr } = await supabase
        .from("purchasing_order_items")
        .select("order_id, qty_ordered, qty_received, unit_cost_snapshot")
        .in("order_id", orderIds);
      if (itemsErr) throw new Error(itemsErr.message);

      type Roll = {
        line_count: number;
        total_qty_ordered: number;
        total_qty_received: number;
        total_value: number;
      };
      const rollup = new Map<string, Roll>();
      for (const it of (items ?? []) as Array<Record<string, unknown>>) {
        const oid = String(it.order_id);
        const r = rollup.get(oid) ?? {
          line_count: 0,
          total_qty_ordered: 0,
          total_qty_received: 0,
          total_value: 0,
        };
        r.line_count += 1;
        r.total_qty_ordered += num(it.qty_ordered);
        r.total_qty_received += num(it.qty_received);
        r.total_value += num(it.qty_ordered) * num(it.unit_cost_snapshot);
        rollup.set(oid, r);
      }

      return orderRows.map((o) => {
        const r = rollup.get(o.id) ?? {
          line_count: 0,
          total_qty_ordered: 0,
          total_qty_received: 0,
          total_value: 0,
        };
        return {
          ...o,
          line_count: r.line_count,
          total_qty_ordered: r.total_qty_ordered,
          total_qty_received: r.total_qty_received,
          total_value: Math.round(r.total_value * 100) / 100,
          percent_received:
            r.total_qty_ordered > 0
              ? Math.round((r.total_qty_received / r.total_qty_ordered) * 100)
              : 0,
        };
      });
    },
    ["purchasing:orders:list"],
    { tags: [TAG], revalidate: REVALIDATE },
  )();
}

export async function getOrderDetail(
  orderId: string,
): Promise<PurchaseOrderDetail | null> {
  const supabase = getSupabase();
  const { data: order, error } = await supabase
    .from("purchasing_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  const { data: items, error: itemsErr } = await supabase
    .from("purchasing_order_items")
    .select(
      "id, order_id, product_id, custom_description, qty_ordered, qty_received, unit_cost_snapshot, notes, created_at, updated_at, purchasing_products(sku, name, category)",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (itemsErr) throw new Error(itemsErr.message);

  const itemRows: OrderItemWithProduct[] = ((items ?? []) as Array<
    Record<string, unknown>
  >).map((it) => {
    const prod = it.purchasing_products as
      | { sku: string; name: string; category: Category }
      | { sku: string; name: string; category: Category }[]
      | null;
    const p = Array.isArray(prod) ? prod[0] : prod;
    const customDesc = (it.custom_description as string | null) ?? null;
    const isCustom = !p;
    return {
      id: String(it.id),
      order_id: String(it.order_id),
      product_id: it.product_id ? String(it.product_id) : null,
      custom_description: customDesc,
      qty_ordered: num(it.qty_ordered),
      qty_received: num(it.qty_received),
      unit_cost_snapshot: num(it.unit_cost_snapshot),
      notes: (it.notes as string | null) ?? null,
      created_at: String(it.created_at),
      updated_at: String(it.updated_at),
      sku: isCustom ? "Custom" : (p?.sku ?? ""),
      name: isCustom ? (customDesc ?? "Custom item") : (p?.name ?? ""),
      category: isCustom ? null : (p?.category ?? null),
    };
  });

  return {
    ...(order as PurchaseOrder),
    items: itemRows,
  };
}

export async function getPurchasingSettings(): Promise<PurchasingSettings> {
  const { data, error } = await getSupabase()
    .from("purchasing_settings")
    .select(
      "expected_fill, lead_time_days, crate_size, season_multipliers, annual_growth_pct, restock_cover_pct",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const rawMults = data?.season_multipliers;
  const season_multipliers =
    Array.isArray(rawMults) && rawMults.length === 12
      ? rawMults.map((n: unknown) => num(n, 1))
      : new Array(12).fill(1);
  return {
    expected_fill: num(data?.expected_fill, 0.7),
    lead_time_days: num(data?.lead_time_days, 90),
    crate_size: num(data?.crate_size, 35),
    season_multipliers,
    annual_growth_pct: num(data?.annual_growth_pct, 0),
    restock_cover_pct: num(data?.restock_cover_pct, 100),
  };
}
