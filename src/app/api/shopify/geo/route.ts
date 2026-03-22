import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { shopifyGraphQL, getStores, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";

const VALID_RANGES = [7, 30, 90, 365];

interface GeoOrderNode extends RevenueFields {
  name: string;
  createdAt: string;
  tags: string[];
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: {
    city: string;
    province: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

interface GeoOrdersResponse {
  orders: {
    edges: { node: GeoOrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

function makeQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node {
            name
            createdAt
            tags
            totalPriceSet { shopMoney { amount currencyCode } }
            ${REVENUE_FIELDS}
            shippingAddress {
              city province country latitude longitude
            }
          }
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
  const days = VALID_RANGES.includes(daysParam) ? daysParam : 30;

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
    const allOrders: GeoOrderNode[] = [];
    let cursor: string | undefined;
    let hasNext = true;
    let pages = 0;

    const maxPages = days <= 30 ? 10 : 40;
    while (hasNext && pages < maxPages) {
      const data = await shopifyGraphQL<GeoOrdersResponse>(storeId, makeQuery(dateFilter, cursor));
      const edges = data.orders.edges;
      allOrders.push(...edges.map((e) => e.node));
      hasNext = data.orders.pageInfo.hasNextPage;
      cursor = edges[edges.length - 1]?.cursor;
      pages++;
    }

    // Build location points (only orders with lat/lng)
    const points = allOrders
      .filter((o) => o.shippingAddress?.latitude && o.shippingAddress?.longitude)
      .map((o) => ({
        lat: o.shippingAddress!.latitude!,
        lng: o.shippingAddress!.longitude!,
        city: o.shippingAddress!.city,
        province: o.shippingAddress!.province,
        country: o.shippingAddress!.country,
        amount: calcNetRevenue(o),
        currency: o.totalPriceSet.shopMoney.currencyCode,
        order: o.name,
        date: o.createdAt.split("T")[0],
        tags: o.tags,
      }));

    // Sales rep breakdown (from tags)
    const repMap = new Map<string, { orders: number; revenue: number }>();
    const regionMap = new Map<string, { orders: number; revenue: number }>();

    for (const order of allOrders) {
      const amount = calcNetRevenue(order);

      // Tags as potential rep names
      for (const tag of order.tags) {
        const entry = repMap.get(tag) ?? { orders: 0, revenue: 0 };
        entry.orders++;
        entry.revenue += amount;
        repMap.set(tag, entry);
      }

      // Region breakdown
      const region = order.shippingAddress
        ? `${order.shippingAddress.province || "Unknown"}, ${order.shippingAddress.country}`
        : "Unknown";
      const rEntry = regionMap.get(region) ?? { orders: 0, revenue: 0 };
      rEntry.orders++;
      rEntry.revenue += amount;
      regionMap.set(region, rEntry);
    }

    // Sort by revenue descending
    const reps = Array.from(repMap.entries())
      .map(([tag, data]) => ({ tag, ...data }))
      .sort((a, b) => b.revenue - a.revenue);

    const regions = Array.from(regionMap.entries())
      .map(([region, data]) => ({ region, ...data }))
      .sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      points,
      reps,
      regions,
      currency: allOrders[0]?.totalPriceSet.shopMoney.currencyCode ?? "USD",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Shopify Geo]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
