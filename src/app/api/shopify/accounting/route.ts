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

interface LineItemNode {
  title: string;
  quantity: number;
  originalUnitPriceSet: { shopMoney: { amount: string } };
  product: { title: string; productType: string } | null;
  variant: {
    inventoryItem: {
      unitCost: { amount: string; currencyCode: string } | null;
    };
  } | null;
}

interface OrderNode extends RevenueFields {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string; lastName: string } | null;
  lineItems: { edges: { node: LineItemNode }[] };
}

interface OrdersResponse {
  orders: {
    edges: { node: OrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

interface UnpaidOrderNode extends RevenueFields {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string; lastName: string } | null;
}

interface UnpaidResponse {
  orders: { edges: { node: UnpaidOrderNode }[] };
}

function makeAccountingQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "${dateFilter}"${after}) {
        edges {
          cursor
          node {
            id
            name
            createdAt
            processedAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            ${REVENUE_FIELDS}
            customer { firstName lastName }
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount } }
                  product {
                    title
                    productType
                  }
                  variant {
                    inventoryItem {
                      unitCost { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

async function fetchAllAccountingOrders(
  storeId: string,
  dateFilter: string,
): Promise<OrderNode[]> {
  const allOrders: OrderNode[] = [];
  let cursor: string | undefined;
  let hasNext = true;
  let pages = 0;
  const maxPages = 40;

  while (hasNext && pages < maxPages) {
    const data = await shopifyGraphQL<OrdersResponse>(
      storeId,
      makeAccountingQuery(dateFilter, cursor),
    );
    const edges = data.orders.edges;
    allOrders.push(...edges.map((e) => e.node));
    hasNext = data.orders.pageInfo.hasNextPage;
    cursor = edges[edges.length - 1]?.cursor;
    pages++;
  }

  return allOrders;
}

const UNPAID_QUERY = `
  query {
    orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "financial_status:pending OR financial_status:partially_paid") {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          ${REVENUE_FIELDS}
          customer { firstName lastName }
        }
      }
    }
  }
`;

interface ProductMarginRow {
  productTitle: string;
  productType: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  hasCostData: boolean;
}

function aggregateProducts(orderNodes: OrderNode[]): ProductMarginRow[] {
  const map = new Map<string, {
    productType: string;
    unitsSold: number;
    revenue: number;
    cost: number;
    hasCostData: boolean;
  }>();

  for (const order of orderNodes) {
    for (const edge of order.lineItems.edges) {
      const li = edge.node;
      const productTitle = li.product?.title ?? li.title ?? "Unknown";
      const productType = li.product?.productType || "Uncategorized";
      const unitPrice = parseFloat(li.originalUnitPriceSet.shopMoney.amount);
      const unitCost = li.variant?.inventoryItem?.unitCost
        ? parseFloat(li.variant.inventoryItem.unitCost.amount)
        : null;

      const entry = map.get(productTitle) ?? {
        productType,
        unitsSold: 0,
        revenue: 0,
        cost: 0,
        hasCostData: false,
      };

      entry.unitsSold += li.quantity;
      entry.revenue += unitPrice * li.quantity;
      if (unitCost !== null) {
        entry.hasCostData = true;
        entry.cost += unitCost * li.quantity;
      }

      map.set(productTitle, entry);
    }
  }

  return Array.from(map.entries())
    .map(([productTitle, d]) => ({
      productTitle,
      productType: d.productType,
      unitsSold: d.unitsSold,
      revenue: Math.round(d.revenue * 100) / 100,
      cost: Math.round(d.cost * 100) / 100,
      profit: Math.round((d.revenue - d.cost) * 100) / 100,
      margin:
        d.hasCostData && d.revenue > 0
          ? Math.round(((d.revenue - d.cost) / d.revenue) * 10000) / 100
          : null,
      hasCostData: d.hasCostData,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function processOrder(node: OrderNode) {
  const revenue = calcNetRevenue(node);
  let totalCost = 0;
  let hasCostData = false;

  for (const li of node.lineItems.edges) {
    const item = li.node;
    const unitCost = item.variant?.inventoryItem?.unitCost;
    if (unitCost) {
      hasCostData = true;
      totalCost += parseFloat(unitCost.amount) * item.quantity;
    }
  }

  const profit = hasCostData ? revenue - totalCost : null;
  const margin = hasCostData && revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : null;

  // Days from order creation to payment completion
  let daysToPayment: number | null = null;
  if (node.processedAt && node.displayFinancialStatus === "PAID") {
    const days =
      (new Date(node.processedAt).getTime() - new Date(node.createdAt).getTime()) /
      (1000 * 60 * 60 * 24);
    daysToPayment = Math.max(0, Math.round(days * 10) / 10);
  }

  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    processedAt: node.processedAt,
    financialStatus: node.displayFinancialStatus,
    fulfillmentStatus: node.displayFulfillmentStatus,
    customer: node.customer
      ? `${node.customer.firstName} ${node.customer.lastName}`
      : "Guest",
    revenue,
    cost: hasCostData ? totalCost : null,
    profit,
    margin,
    daysToPayment,
    currency: node.totalPriceSet.shopMoney.currencyCode,
  };
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

  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
  const since = dateStr(daysAgo(days));
  const prevSince = dateStr(daysAgo(days * 2));
  const prevEnd = dateStr(daysAgo(days));

  try {
    const [currentNodes, previousNodes, unpaidR] = await Promise.all([
      fetchAllAccountingOrders(storeId, `created_at:>='${since}'`),
      fetchAllAccountingOrders(storeId, `created_at:>='${prevSince}' AND created_at:<'${prevEnd}'`),
      shopifyGraphQL<UnpaidResponse>(storeId, UNPAID_QUERY),
    ]);

    const orders = currentNodes.map((n) => processOrder(n));
    const previousOrders = previousNodes.map((n) => processOrder(n));

    // Current period aggregates
    const ordersWithCost = orders.filter((o) => o.cost !== null);
    const totalRevenue = orders.reduce((s, o) => s + o.revenue, 0);
    const totalCost = ordersWithCost.reduce((s, o) => s + (o.cost ?? 0), 0);
    const totalProfit = ordersWithCost.reduce((s, o) => s + (o.profit ?? 0), 0);
    const avgMargin = totalRevenue > 0 && ordersWithCost.length > 0
      ? ((totalRevenue - totalCost) / totalRevenue) * 100
      : null;

    // Previous period aggregates
    const prevWithCost = previousOrders.filter((o) => o.cost !== null);
    const prevRevenue = previousOrders.reduce((s, o) => s + o.revenue, 0);
    const prevCost = prevWithCost.reduce((s, o) => s + (o.cost ?? 0), 0);
    const prevProfit = prevWithCost.reduce((s, o) => s + (o.profit ?? 0), 0);
    const prevMargin = prevRevenue > 0 && prevWithCost.length > 0
      ? ((prevRevenue - prevCost) / prevRevenue) * 100
      : null;

    // Unpaid / collection orders
    const unpaidOrders = unpaidR.orders.edges.map((e) => ({
      id: e.node.id,
      name: e.node.name,
      createdAt: e.node.createdAt,
      financialStatus: e.node.displayFinancialStatus,
      customer: e.node.customer
        ? `${e.node.customer.firstName} ${e.node.customer.lastName}`
        : "Guest",
      amount: calcNetRevenue(e.node),
      currency: e.node.totalPriceSet.shopMoney.currencyCode,
      daysPending: Math.floor(
        (Date.now() - new Date(e.node.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));

    const totalUnpaid = unpaidOrders.reduce((s, o) => s + o.amount, 0);

    // Daily profit margin trend from current period orders
    const dailyMap = new Map<string, { revenue: number; cost: number; orders: number }>();
    for (const o of orders) {
      const day = o.createdAt.split("T")[0];
      const entry = dailyMap.get(day) ?? { revenue: 0, cost: 0, orders: 0 };
      entry.revenue += o.revenue;
      entry.cost += o.cost ?? 0;
      entry.orders += 1;
      dailyMap.set(day, entry);
    }

    const trend = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        revenue: Math.round(d.revenue * 100) / 100,
        cost: Math.round(d.cost * 100) / 100,
        profit: Math.round((d.revenue - d.cost) * 100) / 100,
        margin: d.revenue > 0 ? Math.round(((d.revenue - d.cost) / d.revenue) * 10000) / 100 : 0,
        orders: d.orders,
      }));

    // DSO (Days Sales Outstanding) from paid orders
    const paidOrders = orders.filter((o) => o.daysToPayment !== null);
    const avgDSO =
      paidOrders.length > 0
        ? Math.round(
            (paidOrders.reduce((s, o) => s + o.daysToPayment!, 0) / paidOrders.length) * 10
          ) / 10
        : null;
    const totalPaidRevenue = paidOrders.reduce((s, o) => s + o.revenue, 0);
    const weightedDSO =
      paidOrders.length > 0 && totalPaidRevenue > 0
        ? Math.round(
            (paidOrders.reduce((s, o) => s + o.daysToPayment! * o.revenue, 0) / totalPaidRevenue) *
              10
          ) / 10
        : null;

    // Previous period DSO
    const prevPaidOrders = previousOrders.filter((o) => o.daysToPayment !== null);
    const prevAvgDSO =
      prevPaidOrders.length > 0
        ? Math.round(
            (prevPaidOrders.reduce((s, o) => s + o.daysToPayment!, 0) / prevPaidOrders.length) * 10
          ) / 10
        : null;

    // DSO distribution buckets
    const dsoDist = { sameDay: 0, within7: 0, within30: 0, within60: 0, over60: 0 };
    for (const o of paidOrders) {
      const d = o.daysToPayment!;
      if (d < 1) dsoDist.sameDay++;
      else if (d < 7) dsoDist.within7++;
      else if (d < 30) dsoDist.within30++;
      else if (d < 60) dsoDist.within60++;
      else dsoDist.over60++;
    }

    const currency = orders[0]?.currency ?? unpaidOrders[0]?.currency ?? "USD";

    return NextResponse.json({
      summary: {
        totalRevenue,
        totalCost,
        totalProfit,
        avgMargin,
        orderCount: orders.length,
        ordersWithCostData: ordersWithCost.length,
        currency,
      },
      previous: {
        totalRevenue: prevRevenue,
        totalCost: prevCost,
        totalProfit: prevProfit,
        avgMargin: prevMargin,
        orderCount: previousOrders.length,
      },
      orders,
      unpaid: {
        orders: unpaidOrders,
        totalUnpaid,
        count: unpaidOrders.length,
      },
      trend,
      products: aggregateProducts(currentNodes),
      dso: {
        avgDays: avgDSO,
        weightedAvgDays: weightedDSO,
        paidOrderCount: paidOrders.length,
        previousAvgDays: prevAvgDSO,
        distribution: dsoDist,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Shopify Accounting]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
