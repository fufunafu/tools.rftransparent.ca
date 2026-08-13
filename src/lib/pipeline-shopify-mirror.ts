import { getSupabase } from "@/lib/supabase";
import {
  fetchAllPages,
  getStores,
  REVENUE_FIELDS,
  type ShopifyConnection,
} from "@/lib/shopify";
import { DraftOrdersResponseSchema, OrdersResponseSchema } from "@/lib/schemas";
import type {
  DraftOrderNode,
  OrderNode,
  PipelineSourceData,
} from "@/lib/kpi-sales";

const MAX_PAGES = 80;
const BOOTSTRAP_PARTITIONS = 3;
const MIRROR_PAGE_SIZE = 1000;
const SYNC_FRESH_MS = 10 * 60 * 1000;
const SYNC_OVERLAP_MS = 5 * 60 * 1000;

type ResourceType = "order" | "draft";

interface SyncState {
  store_id: string;
  resource_type: ResourceType;
  history_from: string;
  last_synced_at: string;
}

export interface PipelineMirrorSyncSummary {
  bootstrapped: boolean;
  skipped: boolean;
  recordsSynced: number;
  stores: number;
  syncedAt: string;
}

const ORDERS_MIRROR_QUERY = `
  query($after: String, $search: String) {
    orders(first: 250, sortKey: UPDATED_AT, reverse: true, query: $search, after: $after) {
      edges {
        node { id createdAt updatedAt tags cancelledAt staffMember { firstName lastName } currentSubtotalPriceSet { shopMoney { amount } } ${REVENUE_FIELDS} }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

const DRAFTS_MIRROR_QUERY = `
  query($after: String, $search: String) {
    draftOrders(first: 250, sortKey: UPDATED_AT, reverse: true, query: $search, after: $after) {
      edges {
        node { id name createdAt updatedAt status tags order { id createdAt } ${REVENUE_FIELDS} }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

function dateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

function bootstrapRanges(fromDate: Date): { from: string; to: string }[] {
  const start = new Date(`${dateOnly(fromDate)}T00:00:00.000Z`);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(0, 0, 0, 0);
  const duration = end.getTime() - start.getTime();
  const boundaries = Array.from({ length: BOOTSTRAP_PARTITIONS + 1 }, (_, index) =>
    index === BOOTSTRAP_PARTITIONS
      ? dateOnly(end)
      : dateOnly(new Date(start.getTime() + duration * (index / BOOTSTRAP_PARTITIONS))),
  );
  return boundaries.slice(0, -1).map((from, index) => ({
    from,
    to: boundaries[index + 1],
  }));
}

async function fetchResource(
  storeId: string,
  resourceType: ResourceType,
  search: string,
): Promise<Array<OrderNode | DraftOrderNode>> {
  if (resourceType === "order") {
    const { nodes } = await fetchAllPages<OrderNode>({
      storeId,
      query: ORDERS_MIRROR_QUERY,
      variables: { search },
      getConnection: (raw) =>
        OrdersResponseSchema.parse(raw).orders as unknown as ShopifyConnection<OrderNode>,
      maxPages: MAX_PAGES,
      app: "quotation",
    });
    return nodes;
  }

  const { nodes } = await fetchAllPages<DraftOrderNode>({
    storeId,
    query: DRAFTS_MIRROR_QUERY,
    variables: { search },
    getConnection: (raw) =>
      DraftOrdersResponseSchema.parse(raw).draftOrders as unknown as ShopifyConnection<DraftOrderNode>,
    maxPages: MAX_PAGES,
  });
  return nodes;
}

async function upsertRecords(
  storeId: string,
  resourceType: ResourceType,
  records: Array<OrderNode | DraftOrderNode>,
): Promise<void> {
  const supabase = getSupabase();
  const syncedAt = new Date().toISOString();
  for (let index = 0; index < records.length; index += 500) {
    const rows = records.slice(index, index + 500).map((record) => ({
      store_id: storeId,
      resource_type: resourceType,
      shopify_id: record.id,
      created_at: record.createdAt,
      shopify_updated_at: record.updatedAt ?? record.createdAt,
      payload: record,
      synced_at: syncedAt,
    }));
    const { error } = await supabase
      .from("pipeline_shopify_records")
      .upsert(rows, { onConflict: "store_id,resource_type,shopify_id" });
    if (error) throw new Error(error.message);
  }
}

export async function syncPipelineShopifyMirror(
  fromDate: Date,
  options: { force?: boolean } = {},
): Promise<PipelineMirrorSyncSummary> {
  const supabase = getSupabase();
  const stores = getStores();
  const { data: stateRows, error: stateError } = await supabase
    .from("pipeline_shopify_sync_state")
    .select("store_id, resource_type, history_from, last_synced_at");
  if (stateError) throw new Error(stateError.message);

  const states = new Map(
    ((stateRows ?? []) as SyncState[]).map((state) => [
      `${state.store_id}:${state.resource_type}`,
      state,
    ]),
  );
  const now = new Date();
  let bootstrapped = false;
  let recordsSynced = 0;
  let didWork = false;

  await Promise.all(stores.flatMap((store) => (["order", "draft"] as ResourceType[]).map(async (resourceType) => {
    const state = states.get(`${store.id}:${resourceType}`);
    const needsBootstrap = !state || new Date(state.history_from) > fromDate;
    const isFresh = state
      && now.getTime() - new Date(state.last_synced_at).getTime() < SYNC_FRESH_MS;
    if (!needsBootstrap && isFresh && !options.force) return;

    didWork = true;
    let records: Array<OrderNode | DraftOrderNode>;
    if (needsBootstrap) {
      bootstrapped = true;
      const chunks = await Promise.all(bootstrapRanges(fromDate).map((range) =>
        fetchResource(
          store.id,
          resourceType,
          `created_at:>='${range.from}' AND created_at:<'${range.to}'`,
        ),
      ));
      records = chunks.flat();
    } else {
      const watermark = new Date(
        new Date(state.last_synced_at).getTime() - SYNC_OVERLAP_MS,
      ).toISOString();
      records = await fetchResource(
        store.id,
        resourceType,
        `updated_at:>='${watermark}'`,
      );
    }

    await upsertRecords(store.id, resourceType, records);
    recordsSynced += records.length;
    const syncedAt = now.toISOString();
    const historyFrom = needsBootstrap
      ? fromDate.toISOString()
      : state.history_from;
    const { error } = await supabase
      .from("pipeline_shopify_sync_state")
      .upsert({
        store_id: store.id,
        resource_type: resourceType,
        history_from: historyFrom,
        last_synced_at: syncedAt,
        records_synced: records.length,
        updated_at: syncedAt,
      }, { onConflict: "store_id,resource_type" });
    if (error) throw new Error(error.message);
  })));

  return {
    bootstrapped,
    skipped: !didWork,
    recordsSynced,
    stores: stores.length,
    syncedAt: now.toISOString(),
  };
}

export async function loadPipelineMirror(
  storeIds: string[],
  fromDate: Date,
): Promise<PipelineSourceData | null> {
  const supabase = getSupabase();
  const { data: states, error: stateError } = await supabase
    .from("pipeline_shopify_sync_state")
    .select("store_id, resource_type, history_from")
    .in("store_id", storeIds);
  if (stateError) return null;

  const complete = storeIds.every((storeId) =>
    (["order", "draft"] as ResourceType[]).every((resourceType) =>
      (states ?? []).some((state) =>
        state.store_id === storeId
        && state.resource_type === resourceType
        && new Date(state.history_from) <= fromDate,
      ),
    ),
  );
  if (!complete) return null;

  const orders: OrderNode[] = [];
  const drafts: DraftOrderNode[] = [];
  for (let offset = 0; ; offset += MIRROR_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("pipeline_shopify_records")
      .select("resource_type, payload")
      .in("store_id", storeIds)
      .gte("created_at", fromDate.toISOString())
      .order("created_at", { ascending: true })
      .range(offset, offset + MIRROR_PAGE_SIZE - 1);
    if (error) return null;
    const rows = data ?? [];
    for (const row of rows) {
      if (row.resource_type === "order") orders.push(row.payload as OrderNode);
      else if (row.resource_type === "draft") drafts.push(row.payload as DraftOrderNode);
    }
    if (rows.length < MIRROR_PAGE_SIZE) break;
  }

  return { orders, drafts, warnings: [] };
}

export function pipelineMirrorHistoryStart(fromDate: Date): Date {
  const historyStart = new Date();
  historyStart.setFullYear(historyStart.getFullYear() - 2);
  return fromDate < historyStart ? fromDate : historyStart;
}
