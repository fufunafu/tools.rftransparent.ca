import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { shopifyGraphQL, getStores, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";

function dateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function sumRevenue(edges: { node: RevenueFields }[]) {
  return edges.reduce((s, e) => s + calcNetRevenue(e.node), 0);
}

function makeOrdersQuery(filter: string) {
  return `
    query {
      orders(first: 250, query: "${filter}") {
        edges {
          node {
            ${REVENUE_FIELDS}
          }
        }
      }
    }
  `;
}

function makeDraftQuery(filter: string) {
  return `
    query {
      draftOrders(first: 250, query: "${filter}") {
        edges { node { id } }
      }
    }
  `;
}

export async function GET(req: NextRequest) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId" }, { status: 400 });
  }

  const store = getStores().find((s) => s.id === storeId);
  if (!store) {
    return NextResponse.json({ error: `Unknown store: ${storeId}` }, { status: 400 });
  }

  const today = dateStr(new Date());
  const minus7 = dateStr(daysAgo(7));
  const minus30 = dateStr(daysAgo(30));
  const minus365 = dateStr(daysAgo(365));
  const lyStart = dateStr(daysAgo(395));
  const lyEnd = dateStr(daysAgo(365));

  try {
    const [todayR, weekR, monthR, yearR, lyMonthR, unpaidR, draftTodayR, draftWeekR, draftMonthR, customersR] =
      await Promise.all([
        shopifyGraphQL<{ orders: { edges: { node: RevenueFields }[] } }>(
          storeId, makeOrdersQuery(`created_at:>='${today}'`)
        ),
        shopifyGraphQL<{ orders: { edges: { node: RevenueFields }[] } }>(
          storeId, makeOrdersQuery(`created_at:>='${minus7}'`)
        ),
        shopifyGraphQL<{ orders: { edges: { node: RevenueFields }[] } }>(
          storeId, makeOrdersQuery(`created_at:>='${minus30}'`)
        ),
        shopifyGraphQL<{ orders: { edges: { node: RevenueFields }[] } }>(
          storeId, makeOrdersQuery(`created_at:>='${minus365}'`)
        ),
        shopifyGraphQL<{ orders: { edges: { node: RevenueFields }[] } }>(
          storeId, makeOrdersQuery(`created_at:>='${lyStart}' AND created_at:<='${lyEnd}'`)
        ),
        shopifyGraphQL<{ orders: { edges: { node: { id: string } }[] } }>(
          storeId, `query { orders(first: 250, query: "financial_status:pending") { edges { node { id } } } }`
        ),
        shopifyGraphQL<{ draftOrders: { edges: { node: { id: string } }[] } }>(
          storeId, makeDraftQuery(`created_at:>='${today}'`)
        ),
        shopifyGraphQL<{ draftOrders: { edges: { node: { id: string } }[] } }>(
          storeId, makeDraftQuery(`created_at:>='${minus7}'`)
        ),
        shopifyGraphQL<{ draftOrders: { edges: { node: { id: string } }[] } }>(
          storeId, makeDraftQuery(`created_at:>='${minus30}'`)
        ),
        shopifyGraphQL<{ shop: { currencyCode: string }; customers: { edges: { node: { id: string } }[] } }>(
          storeId,
          `query { shop { currencyCode } customers(first: 250) { edges { node { id } } } }`
        ),
      ]);

    return NextResponse.json({
      today: {
        revenue: sumRevenue(todayR.orders.edges),
        orders: todayR.orders.edges.length,
      },
      week: {
        revenue: sumRevenue(weekR.orders.edges),
        orders: weekR.orders.edges.length,
      },
      month: {
        revenue: sumRevenue(monthR.orders.edges),
        orders: monthR.orders.edges.length,
      },
      year: {
        revenue: sumRevenue(yearR.orders.edges),
        orders: yearR.orders.edges.length,
      },
      lyMonth: {
        revenue: sumRevenue(lyMonthR.orders.edges),
        orders: lyMonthR.orders.edges.length,
      },
      unpaidOrders: unpaidR.orders.edges.length,
      draftOrders: {
        today: draftTodayR.draftOrders.edges.length,
        week: draftWeekR.draftOrders.edges.length,
        month: draftMonthR.draftOrders.edges.length,
      },
      customers: customersR.customers.edges.length,
      currency: customersR.shop.currencyCode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Shopify Metrics]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
