import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores, shopifyGraphQL } from "@/lib/shopify";
import { cached } from "@/lib/api-cache";
import { configuredSalesReps, resolveSalesAttribution } from "@/lib/sales-attribution";
import {
  computeMonthlyCommission,
  type CommissionOrder,
  type MonthlyCommission,
} from "@/lib/commission";

// Commission by month per sales rep, computed from Shopify payment
// transactions (successful sales/captures minus refunds — never
// authorization holds). See src/lib/commission.ts for the model.

interface OrderNode {
  name: string;
  tags: string[];
  currentTotalPriceSet: { shopMoney: { amount: string } } | null;
  currentTotalTaxSet: { shopMoney: { amount: string } } | null;
  currentShippingPriceSet: { shopMoney: { amount: string } } | null;
  totalPriceSet: { shopMoney: { amount: string } } | null;
  totalTaxSet: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet: { shopMoney: { amount: string } } | null;
  transactions: {
    kind: string;
    status: string;
    processedAt: string;
    amountSet: { shopMoney: { amount: string } };
  }[];
}

interface OrdersPage {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: OrderNode[];
  };
}

interface RepCommission {
  employeeId: string;
  name: string;
  rate: number;
  months: MonthlyCommission[];
  totalNet: number;
  totalCommission: number;
}

interface CommissionsPayload {
  year: number;
  reps: RepCommission[];
  ambiguousOrders: { name: string; tags: string[] }[];
  storeErrors: Record<string, string>;
}

// Keep per-page volume modest: each page also carries up to 50 transactions
// per order, and large pages trip the GraphQL cost limit.
const ORDERS_PER_PAGE = 25;
const MAX_PAGES_PER_STORE = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;

function ordersQuery(after: string | null) {
  return `
    query($q: String!) {
      orders(first: ${ORDERS_PER_PAGE}, query: $q, sortKey: CREATED_AT${after ? `, after: "${after}"` : ""}) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          tags
          currentTotalPriceSet { shopMoney { amount } }
          currentTotalTaxSet { shopMoney { amount } }
          currentShippingPriceSet { shopMoney { amount } }
          totalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          transactions(first: 50) {
            kind
            status
            processedAt
            amountSet { shopMoney { amount } }
          }
        }
      }
    }
  `;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphqlWithThrottleRetry<T>(
  storeId: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await shopifyGraphQL<T>(storeId, query, variables);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("THROTTLED") && attempt < 5) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }
}

function money(set: { shopMoney: { amount: string } } | null | undefined): number {
  return set ? Number(set.shopMoney.amount) || 0 : 0;
}

function toCommissionOrder(node: OrderNode): CommissionOrder {
  return {
    name: node.name,
    total: money(node.currentTotalPriceSet) || money(node.totalPriceSet),
    tax: money(node.currentTotalTaxSet) || money(node.totalTaxSet),
    shipping: money(node.currentShippingPriceSet) || money(node.totalShippingPriceSet),
    transactions: node.transactions.map((t) => ({
      kind: t.kind,
      status: t.status,
      processedAt: t.processedAt,
      amount: money(t.amountSet),
    })),
  };
}

async function computeCommissions(year: number): Promise<CommissionsPayload> {
  const { data: employees, error } = await getSupabase()
    .from("employees")
    .select("id, name, department, shopify_tags, commission_rate")
    .eq("active", true)
    .eq("department", "sales")
    .order("name");
  if (error) throw new Error(error.message);

  const reps = configuredSalesReps(employees ?? []);
  const repInfo = new Map(
    (employees ?? []).map((e) => [e.id, { name: e.name as string, rate: Number(e.commission_rate) || 0 }])
  );

  const ordersByRep = new Map<string, CommissionOrder[]>();
  const ambiguousOrders: { name: string; tags: string[] }[] = [];
  const storeErrors: Record<string, string> = {};

  if (reps.length > 0) {
    const allTags = reps.flatMap((r) => r.tags);
    const tagQuery = allTags.map((t) => `tag:'${t.replace(/'/g, "\\'")}'`).join(" OR ");
    // Any payment or refund bumps updated_at, so this range is a safe superset
    // of "orders with money movement in the year".
    const q = `(${tagQuery}) AND updated_at:>=${year}-01-01`;

    for (const store of getStores()) {
      try {
        let after: string | null = null;
        for (let page = 0; page < MAX_PAGES_PER_STORE; page++) {
          const data: OrdersPage = await graphqlWithThrottleRetry<OrdersPage>(
            store.id,
            ordersQuery(after),
            { q }
          );
          for (const node of data.orders.nodes) {
            const attribution = resolveSalesAttribution(node.tags, reps);
            if (attribution.status === "unassigned") continue;
            if (attribution.status === "ambiguous") {
              ambiguousOrders.push({ name: node.name, tags: node.tags });
              continue;
            }
            const list = ordersByRep.get(attribution.employeeId) ?? [];
            list.push(toCommissionOrder(node));
            ordersByRep.set(attribution.employeeId, list);
          }
          if (!data.orders.pageInfo.hasNextPage) break;
          after = data.orders.pageInfo.endCursor;
        }
      } catch (err) {
        storeErrors[store.label] = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const repResults: RepCommission[] = [];
  for (const rep of reps) {
    const info = repInfo.get(rep.id);
    if (!info) continue;
    const months = computeMonthlyCommission(ordersByRep.get(rep.id) ?? [], info.rate, year);
    repResults.push({
      employeeId: rep.id,
      name: info.name,
      rate: info.rate,
      months,
      totalNet: Math.round(months.reduce((s, m) => s + m.net, 0) * 100) / 100,
      totalCommission: Math.round(months.reduce((s, m) => s + m.commission, 0) * 100) / 100,
    });
  }
  repResults.sort((a, b) => b.totalCommission - a.totalCommission);

  return { year, reps: repResults, ambiguousOrders, storeErrors };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const currentYear = new Date().getFullYear();
  const year = Number(req.nextUrl.searchParams.get("year")) || currentYear;
  if (year < 2020 || year > currentYear + 1)
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });

  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const { data, cachedAt } = await cached(
      `kpi-commissions:${year}`,
      CACHE_TTL_MS,
      () => computeCommissions(year),
      { forceRefresh }
    );
    return NextResponse.json({ ...data, cachedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute commissions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
