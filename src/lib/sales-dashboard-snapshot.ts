import { syncSalesShopifyMirror } from "@/lib/sales-shopify-mirror";
import { getSupabase } from "@/lib/supabase";
import { getStores } from "@/lib/shopify";
import { getSalesTargets } from "@/lib/settings";
import { startOfDayInTimeZone } from "@/lib/dates";
import {
  getSalesByStore, getCustomerServiceOps, getSalesTeamOverview, getFollowupOverview,
  type SalesByStore, type CustomerServiceOps, type SalesTeamOverview, type FollowupOverview,
} from "@/lib/ops-dashboard";

export const SALES_SNAPSHOT_KEY = "dashboard:sales:snapshot:v1";
const LOCK_KEY = `${SALES_SNAPSHOT_KEY}:refresh-lock`;
const LOCK_MS = 15 * 60 * 1000;

export interface SalesDashboardSnapshot {
  asOf: string;
  sales: SalesByStore;
  customerService: CustomerServiceOps;
  performers: SalesTeamOverview;
  followup: FollowupOverview;
}

// Page loads never download Shopify history. Keep the last complete snapshot,
// including across midnight and failed refreshes, and always show its date.
export async function readSalesDashboardSnapshot(): Promise<(SalesDashboardSnapshot & { delayed: boolean }) | null> {
  const [{ data, error }, targets] = await Promise.all([
    getSupabase().from("api_cache").select("result").eq("cache_key", SALES_SNAPSHOT_KEY).maybeSingle(),
    getSalesTargets(),
  ]);
  if (error) throw new Error("Could not read the saved sales dashboard.");
  if (!data) return null;
  const snapshot = data.result as SalesDashboardSnapshot;
  return {
    ...snapshot,
    delayed: Date.now() - new Date(snapshot.asOf).getTime() > 15 * 60 * 1000,
    sales: {
      ...snapshot.sales,
      // Target edits still appear immediately, independently of Shopify sync.
      stores: snapshot.sales.stores.map((store) => ({ ...store, target: targets[store.id] ?? null })),
    },
  };
}

export async function refreshSalesDashboardSnapshot(): Promise<{ status: "success" | "skipped"; asOf?: string; sync?: Awaited<ReturnType<typeof syncSalesShopifyMirror>> }> {
  const db = getSupabase();
  const started = new Date();
  const asOf = started.toISOString();
  // A unique api_cache key provides a cross-instance lease. Only expired leases
  // can be removed. The owner token prevents an old worker releasing a new lease.
  const owner = crypto.randomUUID();
  const { error: cleanupError } = await db.from("api_cache").delete()
    .eq("cache_key", LOCK_KEY).lt("computed_at", new Date(started.getTime() - LOCK_MS).toISOString());
  if (cleanupError) throw new Error("Could not check the sales refresh lease.");
  const { error: lockError } = await db.from("api_cache").insert({ cache_key: LOCK_KEY, result: { owner }, computed_at: asOf });
  if (lockError?.code === "23505") return { status: "skipped" };
  if (lockError) throw new Error("Could not acquire the sales refresh lease.");
  try {
    const sync = await syncSalesShopifyMirror();
    const [sales, customerService, performers, followup] = await Promise.all([
      getSalesByStore({ forceRefresh: true }),
      getCustomerServiceOps(undefined, { forceRefresh: true }),
      getSalesTeamOverview({ forceRefresh: true, fromMirror: true }),
      getFollowupOverview(getStores().map((store) => store.id)),
    ]);
    if (!sales.ok || !customerService.ok || !performers.ok || !followup.ok) {
      throw new Error("Sales refresh incomplete. Keeping the previous dashboard snapshot.");
    }
    if (sales.value.failedStores.length || sales.value.warnings.length ||
        customerService.value.warnings.length || customerService.value.quotes.warnings.length ||
        // Conflicting rep tags are intentionally excluded by the attribution
        // rules. Keep that visible warning; it does not indicate a failed fetch.
        performers.value.warnings.some((warning) => !/^\d+ sales records? matched multiple reps and were excluded$/.test(warning))) {
      throw new Error("Sales refresh returned incomplete source data. Keeping the previous dashboard snapshot.");
    }
    // Avoid publishing windows calculated on different business dates.
    if (startOfDayInTimeZone(started).getTime() !== startOfDayInTimeZone(new Date()).getTime()) {
      throw new Error("Sales refresh crossed midnight. The next scheduled run will update the dashboard.");
    }
    const snapshot: SalesDashboardSnapshot = {
      asOf, sales: sales.value, customerService: customerService.value,
      performers: performers.value, followup: followup.value,
    };
    const { error } = await db.from("api_cache").upsert({ cache_key: SALES_SNAPSHOT_KEY, result: snapshot, computed_at: new Date().toISOString() });
    if (error) throw new Error("Could not save the refreshed sales dashboard.");
    return { status: "success", asOf, sync };
  } finally {
    await db.from("api_cache").delete().eq("cache_key", LOCK_KEY).eq("result->>owner", owner);
  }
}
