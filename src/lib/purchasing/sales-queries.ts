import { getPurchasingSettings } from "./queries";
import { currentSeasonMultiplier } from "./seasonality";
import { getSupabase } from "@/lib/supabase";
import type { MonthlySales, SalesHistoryProduct, SalesOverview, SalesSnapshot, SalesSource, SalesState } from "./sales-types";
export async function getSalesStatus(): Promise<{ snapshot: SalesSnapshot | null; states: SalesState[]; checked_at: string }> {
  const db = getSupabase();
  const [snapshot, states] = await Promise.all([
    db.from("purchasing_sales_snapshot").select("*").eq("id", true).maybeSingle(),
    db.from("purchasing_sales_state").select("store_id,history_complete,last_success_at,last_error,window_started_at"),
  ]);
  if (snapshot.error || states.error) throw new Error(snapshot.error?.message || states.error?.message);
  return { snapshot: snapshot.data, states: states.data ?? [], checked_at: new Date().toISOString() };
}
export async function getSalesOverview(): Promise<SalesOverview> {
  const db = getSupabase();
  const status = await getSalesStatus();
  const products = await db.from("purchasing_products").select("id,sku,name,category,avg_monthly_sales_rf,avg_monthly_sales_grs,sales_updated_at").eq("active", true).order("sort_order");
  if (products.error) throw new Error(products.error.message);
  const monthly: MonthlySales[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await db.from("purchasing_sales_monthly").select("*").order("product_id").order("store_id").order("month").range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    monthly.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 1000) break;
  }
  const settings = await getPurchasingSettings();
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7) + "-01";
  return { ...status, seasonality: { month, multiplier: currentSeasonMultiplier(settings) }, products: products.data as SalesHistoryProduct[], monthly };
}
export async function getSalesSources(productId?: string): Promise<SalesSource[]> {
  const db = getSupabase();
  const sources: SalesSource[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from("purchasing_sales_sources").select("*").order("source_key").range(from, from + 999);
    if (productId) query = query.eq("product_id", productId);
    const page = await query;
    if (page.error) throw new Error(page.error.message);
    sources.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 1000) break;
  }
  const totals = new Map<string, { units: number; first_month: string | null; last_month: string | null }>();
  for (let from = 0; ; from += 1000) {
    const page = await db.rpc("purchasing_sales_source_totals").order("source_key").range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    for (const row of page.data ?? []) totals.set(row.source_key, row);
    if ((page.data?.length ?? 0) < 1000) break;
  }
  return sources.map(s => ({ ...s, unit_multiplier: Number(s.unit_multiplier), ...(totals.get(s.source_key) ?? { units: 0, first_month: null, last_month: null }) })).sort((a, b) => b.units - a.units);
}
