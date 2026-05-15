// Shared types for the Purchasing module. Numeric values that arrive as
// strings from PostgREST are coerced to `number` in the query layer.

export type Category = "glass" | "hardware";

export type SopLabel =
  | "no_sales_data"
  | "montreal_transfer"
  | "reorder_plus_montreal"
  | "reorder"
  | "ok";

export type OrderStatus =
  | "draft"
  | "ordered"
  | "in_transit"
  | "received"
  | "cancelled";

export type OrderType = "china" | "montreal";

export const ORDER_TYPE_DISPLAY: Record<OrderType, string> = {
  china: "China order",
  montreal: "Montreal transfer",
};

export interface ProductWithMetrics {
  id: string;
  category: Category;
  sku: string;
  name: string;
  height: number | null;
  width: number | null;
  weight: number | null;
  storage_capacity: number;
  unit_cost_landed: number;
  current_inventory: number;
  avg_monthly_sales_grs: number;
  avg_monthly_sales_rf: number;
  active: boolean;
  sort_order: number;
  inbound: number;
  total_inventory: number;
  daily_sales: number;
  days_of_stock_left: number | null;
  days_of_stock_with_inbound: number | null;
  reorder_point: number;
  perfect_qty: number;
  suggested_qty: number;
  // Minimum units to pull from Montreal so we don't stock out before the
  // next China shipment lands. 0 when no transfer is needed.
  transfer_requirement: number;
  inventory_value: number;
  overstock: number;
  sop_label: SopLabel;
}

export interface ForecastPoint {
  date: string;
  inventory: number;
  event?: "today" | "arrival" | "stockout" | "horizon";
  po_number?: string;
  qty?: number;
}

export interface InventoryForecast {
  product_id: string;
  days_until_stockout: number | null;
  projected_stockout_date: string | null;
  timeline: ForecastPoint[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  // null for custom (free-text) line items
  product_id: string | null;
  // populated only for custom line items
  custom_description: string | null;
  qty_ordered: number;
  qty_received: number;
  unit_cost_snapshot: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemWithProduct extends OrderItem {
  // For custom line items, sku = "Custom" and name = custom_description.
  sku: string;
  name: string;
  category: Category | null;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  status: OrderStatus;
  order_type: OrderType;
  supplier_name: string;
  order_date: string | null;
  eta_date: string | null;
  received_date: string | null;
  notes: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderWithRollup extends PurchaseOrder {
  line_count: number;
  total_qty_ordered: number;
  total_qty_received: number;
  total_value: number;
  percent_received: number;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  items: OrderItemWithProduct[];
}

export interface PurchasingSummary {
  total_inventory_value: number;
  units_on_hand: number;
  open_po_value: number;
  month_order_value: number;
}

export interface PurchasingSettings {
  expected_fill: number;
  lead_time_days: number;
  crate_size: number;
  // 12 per-month multipliers, index 0 = January … index 11 = December.
  // 1.0 means "this month is on the yearly average." Populated by the
  // Recompute-from-Shopify button or edited by hand.
  season_multipliers: number[];
  // Year-over-year growth lift, in percent. 20 = expect 20% more sales
  // than last year across every month. Compounds with seasonality:
  // effective = season_multipliers[m] × (1 + annual_growth_pct / 100).
  annual_growth_pct: number;
}

export const SOP_LABEL_DISPLAY: Record<SopLabel, string> = {
  no_sales_data: "No sales data",
  montreal_transfer: "Montreal transfer",
  reorder_plus_montreal: "Reorder + Montreal transfer",
  reorder: "Reorder now",
  ok: "OK",
};

export const STATUS_DISPLAY: Record<OrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export const STATUS_ORDER: OrderStatus[] = [
  "draft",
  "ordered",
  "in_transit",
  "received",
  "cancelled",
];
