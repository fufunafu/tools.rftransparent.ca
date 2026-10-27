import { getSupabase } from "@/lib/supabase";
import { getStores, shopifyGraphQL, type ShopifyConnection } from "@/lib/shopify";
import { dashboardSalesReps, dashboardSalesSearchFilter } from "@/lib/dashboard-sales";
import { PERFORMER_ORDERS_QUERY, PERFORMER_DRAFTS_QUERY } from "@/lib/sales-shopify-queries";
import { startOfDayInTimeZone, BUSINESS_TIMEZONE } from "@/lib/dates";

export type SalesMirrorResource = "order" | "draft";
type MirrorRecord = { id: string; createdAt: string; updatedAt: string };
type SyncState = { history_from: string; last_synced_at: string; bootstrap_scope: string };
const DB_PAGE = 500;
const OVERLAP_MS = 10 * 60 * 1000;

async function mirrorQuery<T>(storeId: string, query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await shopifyGraphQL<T>(storeId, query, variables, { rejectPartial: true });
    } catch (error) {
      if (attempt >= 4 || !(error instanceof Error) || !/throttled/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
    }
  }
}


// Refuse partial GraphQL responses and pagination failures. A failed sync must
// never advance the watermark and permanently skip a payment, refund or edit.
export async function fetchSalesChanges(storeId: string, kind: SalesMirrorResource, filter: string): Promise<MirrorRecord[]> {
  const query = kind === "order" ? PERFORMER_ORDERS_QUERY : PERFORMER_DRAFTS_QUERY;
  const records = new Map<string, MirrorRecord>();
  let after: string | null = null;
  for (let page = 0; page < 2000; page++) {
    const response: { orders?: ShopifyConnection<MirrorRecord>; draftOrders?: ShopifyConnection<MirrorRecord> } = await mirrorQuery<{ orders?: ShopifyConnection<MirrorRecord>; draftOrders?: ShopifyConnection<MirrorRecord> }>(
      storeId, query, { filter, after },
    );
    const connection: ShopifyConnection<MirrorRecord> | undefined = kind === "order" ? response.orders : response.draftOrders;
    if (!connection) throw new Error("Shopify did not return a complete sales connection.");
    for (const { node } of connection.edges) {
      if (!node.id || !Number.isFinite(Date.parse(node.createdAt)) || !Number.isFinite(Date.parse(node.updatedAt))) {
        throw new Error("Shopify returned an invalid sales record.");
      }
      records.set(node.id, node);
    }
    if (!connection.pageInfo.hasNextPage) return [...records.values()];
    const next: string | undefined = connection.edges.at(-1)?.cursor;
    if (!next || next === after) throw new Error("Shopify sales pagination is incomplete.");
    after = next;
  }
  throw new Error("Shopify sales pagination reached its safety limit.");
}

export function salesSyncFilter(state: SyncState | null, from: Date, scope: string, started: Date): { bootstrap: boolean; filter: string } {
  const bootstrap = !state || new Date(state.history_from) > from || state.bootstrap_scope !== scope;
  const lower = bootstrap ? from.toISOString() : new Date(new Date(state.last_synced_at).getTime() - OVERLAP_MS).toISOString();
  // Incremental pulls deliberately omit rep/tag filters. Removing a rep's tag
  // must update the saved record too, otherwise its old attribution would stick.
  return { bootstrap, filter: `updated_at:>='${lower}' AND updated_at:<='${started.toISOString()}'${bootstrap ? scope : ""}` };
}

async function activeIds(storeId: string, kind: SalesMirrorResource): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += DB_PAGE) {
    const { data, error } = await getSupabase().from("sales_shopify_records").select("shopify_id")
      .eq("store_id", storeId).eq("resource_type", kind).is("deleted_at", null)
      .order("shopify_id").range(offset, offset + DB_PAGE - 1);
    if (error) throw new Error("Could not read saved sales record IDs.");
    ids.push(...(data ?? []).map((row) => row.shopify_id as string));
    if ((data ?? []).length < DB_PAGE) return ids;
  }
}

// Deletions have no updated_at delta. Check only IDs, in cheap batches, instead
// of downloading order history again. Keep tombstones for recovery/auditing.
async function reconcileDeleted(storeId: string, kind: SalesMirrorResource, at: string): Promise<number> {
  const ids = await activeIds(storeId, kind);
  const deleted: string[] = [];
  for (let offset = 0; offset < ids.length; offset += 250) {
    const batch = ids.slice(offset, offset + 250);
    const { nodes } = await mirrorQuery<{ nodes: Array<{ id: string } | null> }>(storeId,
      "query($ids: [ID!]!) { nodes(ids: $ids) { id } }", { ids: batch });
    if (!Array.isArray(nodes) || nodes.length !== batch.length || nodes.some((node, i) => node && node.id !== batch[i])) {
      throw new Error("Shopify sales deletion check was incomplete.");
    }
    nodes.forEach((node, i) => { if (node === null) deleted.push(batch[i]); });
  }
  // A changed access scope must not silently erase most of the reporting copy.
  if (deleted.length > 10 && deleted.length > ids.length / 4) {
    throw new Error("Too many saved sales records became inaccessible. Keeping the previous snapshot.");
  }
  for (let offset = 0; offset < deleted.length; offset += 250) {
    const { error } = await getSupabase().from("sales_shopify_records").update({ deleted_at: at })
      .eq("store_id", storeId).eq("resource_type", kind).in("shopify_id", deleted.slice(offset, offset + 250));
    if (error) throw new Error("Could not reconcile deleted sales records.");
  }
  return deleted.length;
}

export async function syncSalesShopifyMirror(): Promise<{ recordsSynced: number; deleted: number; bootstrapped: number }> {
  const db = getSupabase();
  const { data: employees, error } = await db.from("employees").select("id, name, department, shopify_tags").eq("active", true).order("name");
  if (error) throw new Error("Could not read sales representatives for synchronization.");
  const reps = dashboardSalesReps(employees ?? []);
  const storeIds = [...new Set(reps.filter((rep) => !rep.placeholder).map((rep) => rep.storeId))];
  if (storeIds.some((id) => !getStores().some((store) => store.id === id))) throw new Error("A sales Shopify connection is missing.");
  const started = new Date();
  const results = await Promise.allSettled(storeIds.map(async (storeId) => {
    const counts = { recordsSynced: 0, deleted: 0, bootstrapped: 0 };
    // Sequential resources within a store share its Shopify API rate budget.
    for (const kind of ["order", "draft"] as const) {
      const { data: state, error: stateError } = await db.from("sales_shopify_sync_state").select("history_from,last_synced_at,bootstrap_scope")
        .eq("store_id", storeId).eq("resource_type", kind).maybeSingle();
      if (stateError) throw new Error("Could not read sales sync progress.");
      // Current and preceding one-year payment windows. Drafts only need the
      // current year, but both use updated_at so late changes are captured.
      const from = startOfDayInTimeZone(started, BUSINESS_TIMEZONE, 1 - (kind === "order" ? 730 : 365));
      const scope = dashboardSalesSearchFilter(storeId, reps, "");
      const plan = salesSyncFilter(state, from, scope, started);
      const records = await fetchSalesChanges(storeId, kind, plan.filter);
      for (let offset = 0; offset < records.length; offset += 250) {
        const rows = records.slice(offset, offset + 250).map((record) => ({
          store_id: storeId, resource_type: kind, shopify_id: record.id,
          created_at: record.createdAt, shopify_updated_at: record.updatedAt,
          payload: record, synced_at: started.toISOString(), deleted_at: null,
        }));
        const { error: writeError } = await db.from("sales_shopify_records").upsert(rows, { onConflict: "store_id,resource_type,shopify_id" });
        if (writeError) throw new Error("Could not save Shopify sales changes.");
      }
      counts.deleted += await reconcileDeleted(storeId, kind, started.toISOString());
      const { error: progressError } = await db.from("sales_shopify_sync_state").upsert({
        store_id: storeId, resource_type: kind,
        history_from: plan.bootstrap ? from.toISOString() : state!.history_from,
        bootstrap_scope: scope, last_synced_at: started.toISOString(), records_synced: records.length,
      }, { onConflict: "store_id,resource_type" });
      if (progressError) throw new Error("Could not save sales sync progress.");
      counts.recordsSynced += records.length;
      if (plan.bootstrap) counts.bootstrapped++;
    }
    return counts;
  }));
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  const completed = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  return completed.reduce((total, row) => ({ recordsSynced: total.recordsSynced + row.recordsSynced, deleted: total.deleted + row.deleted, bootstrapped: total.bootstrapped + row.bootstrapped }), { recordsSynced: 0, deleted: 0, bootstrapped: 0 });
}

export async function loadSalesMirror<T>(storeId: string, kind: SalesMirrorResource, from: Date): Promise<{ nodes: T[]; truncated: boolean }> {
  const db = getSupabase();
  const { data: state, error: stateError } = await db.from("sales_shopify_sync_state").select("history_from")
    .eq("store_id", storeId).eq("resource_type", kind).maybeSingle();
  if (stateError || !state || new Date(state.history_from) > from) throw new Error("Sales history has not finished its initial sync.");
  const nodes: T[] = [];
  for (let offset = 0; ; offset += DB_PAGE) {
    const { data, error } = await db.from("sales_shopify_records").select("payload")
      .eq("store_id", storeId).eq("resource_type", kind).is("deleted_at", null)
      .gte(kind === "order" ? "shopify_updated_at" : "created_at", from.toISOString())
      .order("shopify_id").range(offset, offset + DB_PAGE - 1);
    if (error) throw new Error("Could not load saved sales history.");
    nodes.push(...(data ?? []).map((row) => row.payload as T));
    if ((data ?? []).length < DB_PAGE) return { nodes, truncated: false };
  }
}
