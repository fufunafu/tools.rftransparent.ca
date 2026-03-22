import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { shopifyGraphQL, getStores, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";

const VALID_RANGES = [7, 30, 90, 365] as const;

interface OrderNode extends RevenueFields {
  createdAt: string;
}

interface OrdersResponse {
  orders: {
    edges: { node: OrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

function makeQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node { createdAt ${REVENUE_FIELDS} }
          cursor
        }
        pageInfo { hasNextPage }
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
  const daysParam = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
  const days = VALID_RANGES.includes(daysParam as typeof VALID_RANGES[number]) ? daysParam : 30;

  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId" }, { status: 400 });
  }

  const store = getStores().find((s) => s.id === storeId);
  if (!store) {
    return NextResponse.json({ error: `Unknown store: ${storeId}` }, { status: 400 });
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const dateFilter = startDate.toISOString().split("T")[0];

  try {
    // Paginated fetch of all orders in range
    const allOrders: OrderNode[] = [];
    let cursor: string | undefined;
    let hasNext = true;
    let pages = 0;
    const maxPages = days <= 30 ? 10 : 40; // 250 * 40 = 10,000 orders max for longer ranges

    while (hasNext && pages < maxPages) {
      const data = await shopifyGraphQL<OrdersResponse>(storeId, makeQuery(dateFilter, cursor));
      const edges = data.orders.edges;
      allOrders.push(...edges.map((e) => e.node));
      hasNext = data.orders.pageInfo.hasNextPage;
      cursor = edges[edges.length - 1]?.cursor;
      pages++;
    }

    // Group by date
    const dailyMap = new Map<string, { revenue: number; orders: number }>();

    // Pre-fill all dates in range so chart has no gaps
    for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
      dailyMap.set(d.toISOString().split("T")[0], { revenue: 0, orders: 0 });
    }

    for (const order of allOrders) {
      const date = order.createdAt.split("T")[0];
      const entry = dailyMap.get(date);
      const amount = calcNetRevenue(order);
      if (entry) {
        entry.revenue += amount;
        entry.orders += 1;
      }
    }

    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        revenue: Math.round(data.revenue * 100) / 100,
        orders: data.orders,
      }));

    return NextResponse.json({ daily, totalOrders: allOrders.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Shopify Chart]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
