import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import type {
  Category,
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

// Not server-cached: edits to current_inventory etc. need to surface on
// the very next SWR refetch. The underlying view query is cheap.
export async function listProductsWithMetrics(
  category?: Category | null,
): Promise<ProductWithMetrics[]> {
  let q = getSupabase()
    .from("purchasing_reorder_view")
    .select("*")
    .order("sort_order", { ascending: true });
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    category: r.category as Category,
    sku: String(r.sku),
    name: String(r.name),
    height: numOrNull(r.height),
    width: numOrNull(r.width),
    weight: numOrNull(r.weight),
    storage_capacity: num(r.storage_capacity),
    unit_cost_landed: num(r.unit_cost_landed),
    current_inventory: num(r.current_inventory),
    avg_monthly_sales_grs: num(r.avg_monthly_sales_grs),
    avg_monthly_sales_rf: num(r.avg_monthly_sales_rf),
    active: Boolean(r.active),
    sort_order: num(r.sort_order),
    inbound: num(r.inbound),
    total_inventory: num(r.total_inventory),
    daily_sales: num(r.daily_sales),
    days_of_stock_left: numOrNull(r.days_of_stock_left),
    days_of_stock_with_inbound: numOrNull(r.days_of_stock_with_inbound),
    reorder_point: num(r.reorder_point),
    restock_target: num(r.restock_target),
    days_until_next_arrival: numOrNull(r.days_until_next_arrival),
    perfect_qty: num(r.perfect_qty),
    suggested_qty: num(r.suggested_qty),
    transfer_requirement: num(r.transfer_requirement),
    inventory_value: num(r.inventory_value),
    overstock: num(r.overstock),
    sop_label: (r.sop_label as ProductWithMetrics["sop_label"]) ?? "ok",
  }));
}

export function getPurchasingSummary(): Promise<PurchasingSummary> {
  return unstable_cache(
    async () => {
      const supabase = getSupabase();

      const { data: prodRows, error: prodErr } = await supabase
        .from("purchasing_reorder_view")
        .select("current_inventory, inventory_value");
      if (prodErr) throw new Error(prodErr.message);

      let units_on_hand = 0;
      let total_inventory_value = 0;
      for (const r of (prodRows ?? []) as Array<Record<string, unknown>>) {
        units_on_hand += num(r.current_inventory);
        total_inventory_value += num(r.inventory_value);
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

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const { data: monthItems, error: monthErr } = await supabase
        .from("purchasing_order_items")
        .select(
          "qty_ordered, unit_cost_snapshot, purchasing_orders!inner(order_date, status)",
        )
        .gte(
          "purchasing_orders.order_date",
          monthStart.toISOString().slice(0, 10),
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
