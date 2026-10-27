import { randomUUID } from "node:crypto";
import { getSupabase } from "@/lib/supabase";
import { getStores, shopifyGraphQL } from "@/lib/shopify";
import { matchSalesLine, salesSourceKey, type SalesLine, type SalesProduct } from "./sales-matching";

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
export interface SalesOrder {
  id: string; createdAt: string; processedAt: string; updatedAt: string;
  cancelledAt: string | null; test: boolean; displayFinancialStatus: string;
  lineItems: Connection<SalesLine>;
}
interface State {
  store_id: string; timezone: string; watermark: string | null; window_started_at: string | null;
  cursor: string | null; history_complete: boolean;
}
async function queryShopify<T>(store: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await shopifyGraphQL<T>(store, query, variables, { rejectPartial: true }); }
    catch (error) {
      if (attempt >= 3 || !/throttl/i.test(error instanceof Error ? error.message : "")) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
}
const LINE_FIELDS = `id sku title variantTitle quantity currentQuantity variant { id } product { id }`;
const ORDER_QUERY = `query($after:String,$query:String!){orders(first:20,after:$after,sortKey:UPDATED_AT,query:$query){nodes{
  id createdAt processedAt updatedAt cancelledAt test displayFinancialStatus
  lineItems(first:20){nodes{${LINE_FIELDS}} pageInfo{hasNextPage endCursor}}
} pageInfo{hasNextPage endCursor}}}`;
const LINES_QUERY = `query($id:ID!,$after:String){order(id:$id){lineItems(first:100,after:$after){nodes{${LINE_FIELDS}} pageInfo{hasNextPage endCursor}}}}`;
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export function orderMonth(date: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(new Date(date));
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-01`;
}
export async function saveSalesOrders(store: string, timezone: string, orders: SalesOrder[], products: SalesProduct[]) {
  const db = getSupabase();
  const sources = new Map<string, Record<string, unknown>>();
  const lines = [];
  for (const order of orders) {
    if (order.lineItems.pageInfo.hasNextPage) throw new Error("Refusing an order with incomplete line items");
    for (const line of order.lineItems.nodes) {
      const key = salesSourceKey(store, line);
      sources.set(key, { source_key: key, store_id: store, sku: line.sku, title: line.title, variant_title: line.variantTitle,
        variant_id: line.variant?.id ?? null, ...matchSalesLine(line, products) });
      lines.push({ order_id: order.id, line_id: line.id, source_key: key, quantity: line.quantity, net_quantity: line.currentQuantity });
    }
  }
  const sourceRows = [...sources.values()];
  for (let i = 0; i < sourceRows.length; i += 300) {
    checked(await db.from("purchasing_sales_sources").upsert(sourceRows.slice(i, i + 300), { onConflict: "source_key", ignoreDuplicates: true }));
  }
  checked(await db.rpc("purchasing_sales_ingest", {
    p_store: store,
    p_orders: orders.map(o => ({ order_id: o.id, ordered_at: o.processedAt || o.createdAt, updated_at: o.updatedAt,
      month: orderMonth(o.processedAt || o.createdAt, timezone),
      excluded: Boolean(o.test || o.cancelledAt || o.displayFinancialStatus === "VOIDED") })),
    p_lines: lines,
  }));
}

/** Bounded, resumable incremental import. Checkpoints only advance after complete orders are saved. */
export async function syncPurchasingSales({ maxPages = 15, budgetMs = 180_000 } = {}) {
  const db = getSupabase();
  const token = randomUUID();
  if (!checked(await db.rpc("purchasing_sales_claim", { p_token: token }))) return { skipped: "already_running" };
  const deadline = Date.now() + budgetMs;
  const result: { stores: Array<{ store: string; orders: number; complete: boolean; error?: string }>; published: boolean } = { stores: [], published: false };
  try {
    const products = checked(await db.from("purchasing_products").select("id,sku,name,category,height,width")) as SalesProduct[];
    for (const storeId of ["store1", "store2"]) {
      let saved = 0;
      try {
        if (!getStores().some(s => s.id === storeId)) throw new Error(`Missing ${storeId} configuration`);
        const state = checked(await db.from("purchasing_sales_state").select("*").eq("store_id", storeId).single()) as State;
        if (!state.window_started_at) {
          const info = await queryShopify<{ shop: { ianaTimezone: string }; currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(storeId,
            `{shop{ianaTimezone} currentAppInstallation{accessScopes{handle}}}`, undefined);
          if (!info.currentAppInstallation.accessScopes.some(s => s.handle === "read_all_orders")) throw new Error("Historical order permission is required");
          state.timezone = info.shop.ianaTimezone;
          state.window_started_at = new Date().toISOString();
          checked(await db.from("purchasing_sales_state").update({ timezone: state.timezone, window_started_at: state.window_started_at, last_error: null }).eq("store_id", storeId));
        }
        const since = state.watermark ? new Date(new Date(state.watermark).getTime() - 300_000).toISOString() : "1970-01-01T00:00:00Z";
        const query = `updated_at:>='${since}' updated_at:<='${state.window_started_at}'`;
        let complete = false;
        for (let page = 0; page < maxPages && Date.now() < deadline; page++) {
          const data = await queryShopify<{ orders: Connection<SalesOrder> }>(storeId, ORDER_QUERY, { query, after: state.cursor });
          for (const order of data.orders.nodes) {
            while (order.lineItems.pageInfo.hasNextPage) {
              const previous = order.lineItems.pageInfo.endCursor;
              if (!previous) throw new Error("Missing line-item pagination cursor");
              const more = await queryShopify<{ order: { lineItems: Connection<SalesLine> } | null }>(storeId, LINES_QUERY, { id: order.id, after: previous });
              if (!more.order) throw new Error("Order disappeared while reading its items");
              order.lineItems.nodes.push(...more.order.lineItems.nodes);
              order.lineItems.pageInfo = more.order.lineItems.pageInfo;
              if (order.lineItems.pageInfo.hasNextPage && previous === order.lineItems.pageInfo.endCursor) throw new Error("Line-item cursor did not advance");
            }
          }
          await saveSalesOrders(storeId, state.timezone, data.orders.nodes, products);
          saved += data.orders.nodes.length;
          if (!data.orders.pageInfo.hasNextPage) {
            checked(await db.from("purchasing_sales_state").update({ watermark: state.window_started_at, window_started_at: null, cursor: null,
              history_complete: true, last_success_at: new Date().toISOString(), last_error: null }).eq("store_id", storeId));
            complete = true;
            break;
          }
          const cursor = data.orders.pageInfo.endCursor;
          if (!cursor || cursor === state.cursor) throw new Error("Order cursor did not advance");
          state.cursor = cursor;
          checked(await db.from("purchasing_sales_state").update({ cursor }).eq("store_id", storeId));
          // Keep below the standard Shopify GraphQL restore rate.
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        result.stores.push({ store: storeId, orders: saved, complete });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Import failed";
        checked(await db.from("purchasing_sales_state").update({ last_error: message.slice(0, 500) }).eq("store_id", storeId));
        result.stores.push({ store: storeId, orders: saved, complete: false, error: message });
      }
    }
    result.published = Boolean(checked(await db.rpc("purchasing_sales_publish")));
    return result;
  } finally {
    checked(await db.from("purchasing_sales_lock").update({ token: null, expires_at: null }).eq("id", true).eq("token", token));
  }
}
