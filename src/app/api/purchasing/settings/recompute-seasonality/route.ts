// Recomputes the 12 per-month seasonality multipliers from the last 12
// *completed* calendar months of orders, pooled across every connected
// Shopify store. Each multiplier = month_revenue / yearly_average, so the
// 12 numbers naturally average to 1.0.
//
// Triggered manually from the Purchasing → Settings page.

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  REVENUE_FIELDS,
  calcNetRevenue,
  getStores,
  shopifyGraphQL,
  type RevenueFields,
} from "@/lib/shopify";
import { isManagementUser, getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { logActivity } from "@/lib/purchasing/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface OrderNode extends RevenueFields {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
}

interface OrdersResponse {
  orders: {
    edges: { node: OrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

const MAX_PAGES = 80; // 80 × 250 = 20,000 orders per store

function makeQuery(fromDate: string, cursor?: string): string {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${fromDate}'"${after}) {
        edges {
          node { id createdAt cancelledAt ${REVENUE_FIELDS} }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

async function fetchStoreOrders(
  storeId: string,
  fromDate: string,
): Promise<OrderNode[]> {
  const out: OrderNode[] = [];
  let cursor: string | undefined;
  let hasNext = true;
  let pages = 0;
  while (hasNext && pages < MAX_PAGES) {
    const data = await shopifyGraphQL<OrdersResponse>(
      storeId,
      makeQuery(fromDate, cursor),
    );
    const edges = data.orders.edges;
    out.push(...edges.map((e) => e.node));
    hasNext = data.orders.pageInfo.hasNextPage;
    cursor = edges[edges.length - 1]?.cursor;
    pages++;
  }
  return out;
}

export async function POST() {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Sales seasonality is computed from RF + GRS only. BC Transparent serves
  // a different market and would skew the multipliers if pooled in. We
  // identify BC by label (case-insensitive substring) so this still works
  // even if the env labels are tweaked.
  const allStores = getStores();
  const stores = allStores.filter((s) => !s.label.toLowerCase().includes("bc"));
  if (stores.length === 0) {
    return NextResponse.json(
      {
        error:
          allStores.length === 0
            ? "No Shopify stores configured (set SHOPIFY_STORE_1, SHOPIFY_CLIENT_ID_1, SHOPIFY_CLIENT_SECRET_1, …)."
            : `Every configured store was excluded as BC. Configured: ${allStores.map((s) => s.label).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // Pull ~13 months of history so we have 12 completed months to draw from
  // even when "today" is mid-month.
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCMonth(since.getUTCMonth() - 13);
  const fromDate = since.toISOString().slice(0, 10);

  const perStore: Array<{ storeId: string; label: string; orders: number; revenue: number; error?: string }> = [];
  const monthlyTotals = new Map<string, number>(); // "YYYY-MM" → revenue

  for (const store of stores) {
    try {
      const orders = await fetchStoreOrders(store.id, fromDate);
      let storeRevenue = 0;
      let counted = 0;
      for (const o of orders) {
        if (o.cancelledAt) continue;
        const monthKey = o.createdAt.slice(0, 7);
        const rev = calcNetRevenue(o);
        monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + rev);
        storeRevenue += rev;
        counted++;
      }
      perStore.push({ storeId: store.id, label: store.label, orders: counted, revenue: storeRevenue });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[seasonality-recompute] ${store.id} failed:`, err);
      perStore.push({ storeId: store.id, label: store.label, orders: 0, revenue: 0, error: msg });
    }
  }

  // Drop the current (in-progress) month and take the most recent 12 completed.
  const now = new Date();
  const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const completed = [...monthlyTotals.entries()]
    .filter(([k]) => k < currentMonthKey)
    .sort(([a], [b]) => a.localeCompare(b));
  const last12 = completed.slice(-12);

  if (last12.length < 12) {
    return NextResponse.json(
      {
        error: `Need 12 completed months of order history to compute seasonality; found ${last12.length}.`,
        perStore,
      },
      { status: 400 },
    );
  }

  const avg = last12.reduce((s, [, v]) => s + v, 0) / 12;
  if (avg <= 0) {
    return NextResponse.json(
      { error: "No revenue found in the trailing 12 months.", perStore },
      { status: 400 },
    );
  }

  const multipliers = new Array(12).fill(1);
  const monthBreakdown: Array<{ monthKey: string; monthIdx: number; revenue: number; multiplier: number }> = [];
  for (const [key, total] of last12) {
    const monthIdx = parseInt(key.slice(5, 7), 10) - 1;
    // Clamp to keep extreme outliers from breaking downstream math.
    const mult = Math.max(0.05, Math.min(5, total / avg));
    multipliers[monthIdx] = Math.round(mult * 1000) / 1000;
    monthBreakdown.push({ monthKey: key, monthIdx, revenue: Math.round(total), multiplier: multipliers[monthIdx] });
  }

  const supabase = getSupabase();
  const { error: updateErr } = await supabase
    .from("purchasing_settings")
    .update({ season_multipliers: multipliers })
    .eq("id", 1);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  revalidateTag("purchasing", "max");

  const user = await getAuthenticatedUser();
  await logActivity({
    event_type: "settings_update",
    field: "season_multipliers",
    new_value: multipliers.join(","),
    actor_email: user?.email?.toLowerCase() ?? null,
  });

  return NextResponse.json({
    status: "success",
    avg_monthly_revenue: Math.round(avg),
    multipliers,
    perStore,
    monthBreakdown,
  });
}
