export interface SalesSnapshot {
  refreshed_at: string; period_start: string; period_end: string; orders_count: number; review_sources: number; review_units: number;
}
export interface SalesState {
  store_id: string; history_complete: boolean; last_success_at: string | null; last_error: string | null; window_started_at: string | null;
}
export interface MonthlySales { product_id: string; store_id: string; month: string; units: number; estimated_units: number }
export interface SalesHistoryProduct {
  id: string; sku: string; name: string; category: string; avg_monthly_sales_rf: number; avg_monthly_sales_grs: number; sales_updated_at: string | null;
}
export interface SalesOverview { seasonality: { month: string; multiplier: number }; snapshot: SalesSnapshot | null; states: SalesState[]; products: SalesHistoryProduct[]; monthly: MonthlySales[] }
export interface SalesSource {
  source_key: string; store_id: string; sku: string | null; title: string; variant_title: string | null; product_id: string | null;
  method: string; reason: string; unit_multiplier: number; reviewed_by: string | null; units: number; first_month: string | null; last_month: string | null;
}
