import { NextRequest, NextResponse } from "next/server";
import { isEmployeeAuthenticated, getSelectedEmployeeId } from "@/lib/employee-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores, shopifyGraphQL } from "@/lib/shopify";
import {
  getEmployeeSalesMetrics,
  getEmployeeDraftMetrics,
  getMonthlyConversionHistory,
} from "@/lib/kpi-sales";

type Period = "monthly" | "quarterly" | "yearly";

function getPeriodRange(period: Period, dateStr: string) {
  const date = new Date(dateStr + "T00:00:00");
  let start: Date, end: Date, prevStart: Date, prevEnd: Date;

  if (period === "monthly") {
    start = new Date(date.getFullYear(), date.getMonth(), 1);
    end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    prevStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    prevEnd = new Date(start);
  } else if (period === "quarterly") {
    const q = Math.floor(date.getMonth() / 3);
    start = new Date(date.getFullYear(), q * 3, 1);
    end = new Date(date.getFullYear(), q * 3 + 3, 1);
    prevStart = new Date(date.getFullYear(), q * 3 - 3, 1);
    prevEnd = new Date(start);
  } else {
    start = new Date(date.getFullYear(), 0, 1);
    end = new Date(date.getFullYear() + 1, 0, 1);
    prevStart = new Date(date.getFullYear() - 1, 0, 1);
    prevEnd = new Date(start);
  }

  return { start, end, prevStart, prevEnd };
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

// --- Warehouse helpers (same as admin KPI route) ---

interface FulfillmentOrderNode {
  createdAt: string;
  displayFulfillmentStatus: string;
  fulfillments: { createdAt: string }[];
}

interface FulfillmentOrdersResponse {
  orders: {
    edges: { node: FulfillmentOrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

function makeFulfilledOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "fulfillment_status:shipped created_at:>='${dateFilter}'"${after}) {
        edges {
          node { createdAt displayFulfillmentStatus fulfillments { createdAt } }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

function makeUnfulfilledOrdersQuery(cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, query: "fulfillment_status:unfulfilled"${after}) {
        edges {
          node { createdAt displayFulfillmentStatus }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

export async function GET(req: NextRequest) {
  if (!(await isEmployeeAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const employeeId = await getSelectedEmployeeId();
  if (!employeeId) {
    return NextResponse.json({ error: "No employee selected" }, { status: 400 });
  }

  const period = (req.nextUrl.searchParams.get("period") || "monthly") as Period;
  const dateStr = req.nextUrl.searchParams.get("date") || toDateStr(new Date());
  const view = req.nextUrl.searchParams.get("view"); // "history" for conversion chart

  // Fetch employee
  const { data: employee, error: empError } = await getSupabase()
    .from("employees")
    .select("*, locations(id, name, shopify_store_ids)")
    .eq("id", employeeId)
    .single();

  if (empError || !employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const stores = getStores();
  const storeIds = employee.locations?.shopify_store_ids ?? stores.map((s) => s.id);

  // --- SALES DEPARTMENT ---
  if (employee.department === "sales") {
    if (view === "history") {
      const history = await getMonthlyConversionHistory(
        employee.shopify_tags ?? [],
        storeIds,
        12
      );
      return NextResponse.json({ history });
    }

    const { start, end, prevStart, prevEnd } = getPeriodRange(period, dateStr);

    const [curSales, prevSales, curDrafts, prevDrafts] = await Promise.all([
      getEmployeeSalesMetrics(employee.shopify_tags ?? [], storeIds, start, end),
      getEmployeeSalesMetrics(employee.shopify_tags ?? [], storeIds, prevStart, prevEnd),
      getEmployeeDraftMetrics(employee.shopify_tags ?? [], storeIds, start, end),
      getEmployeeDraftMetrics(employee.shopify_tags ?? [], storeIds, prevStart, prevEnd),
    ]);

    return NextResponse.json({
      department: "sales",
      employee: { id: employee.id, name: employee.name },
      period,
      dateRange: {
        current: { from: toDateStr(start), to: toDateStr(end) },
        previous: { from: toDateStr(prevStart), to: toDateStr(prevEnd) },
      },
      metrics: {
        current: {
          revenue: curSales.revenue,
          orders: curSales.orders,
          aov: curSales.aov,
          quotes: curDrafts.totalDrafts,
          conversion_rate: curDrafts.conversionRate,
        },
        previous: {
          revenue: prevSales.revenue,
          orders: prevSales.orders,
          aov: prevSales.aov,
          quotes: prevDrafts.totalDrafts,
          conversion_rate: prevDrafts.conversionRate,
        },
        change: {
          revenue: pctChange(curSales.revenue, prevSales.revenue),
          orders: pctChange(curSales.orders, prevSales.orders),
          aov: pctChange(curSales.aov, prevSales.aov),
          quotes: pctChange(curDrafts.totalDrafts, prevDrafts.totalDrafts),
          conversion_rate: pctChange(curDrafts.conversionRate, prevDrafts.conversionRate),
        },
      },
      drafts: curDrafts.drafts.slice(0, 20),
    });
  }

  // --- WAREHOUSE DEPARTMENT ---
  if (employee.department === "warehouse") {
    const { start, end, prevStart, prevEnd } = getPeriodRange(period, dateStr);
    const fetchDate = toDateStr(prevStart);
    const now = new Date();

    const fulfilledOrders: FulfillmentOrderNode[] = [];
    const unfulfilledOrders: FulfillmentOrderNode[] = [];

    for (const store of stores) {
      if (!storeIds.includes(store.id)) continue;
      try {
        let cursor: string | undefined;
        let hasNext = true;
        let pages = 0;
        while (hasNext && pages < 20) {
          const data = await shopifyGraphQL<FulfillmentOrdersResponse>(
            store.id,
            makeFulfilledOrdersQuery(fetchDate, cursor)
          );
          const edges = data.orders.edges;
          fulfilledOrders.push(...edges.map((e) => e.node));
          hasNext = data.orders.pageInfo.hasNextPage;
          cursor = edges[edges.length - 1]?.cursor;
          pages++;
        }
      } catch (err) {
        console.error(`[Employee Dashboard] Fulfilled fetch failed for ${store.id}:`, err);
      }

      try {
        let cursor: string | undefined;
        let hasNext = true;
        let pages = 0;
        while (hasNext && pages < 10) {
          const data = await shopifyGraphQL<FulfillmentOrdersResponse>(
            store.id,
            makeUnfulfilledOrdersQuery(cursor)
          );
          const edges = data.orders.edges;
          unfulfilledOrders.push(...edges.map((e) => e.node));
          hasNext = data.orders.pageInfo.hasNextPage;
          cursor = edges[edges.length - 1]?.cursor;
          pages++;
        }
      } catch (err) {
        console.error(`[Employee Dashboard] Unfulfilled fetch failed for ${store.id}:`, err);
      }
    }

    const calcPeriodMetrics = (periodStart: Date, periodEnd: Date) => {
      const periodFulfilled = fulfilledOrders.filter((o) => {
        const d = new Date(o.createdAt);
        return d >= periodStart && d < periodEnd;
      });
      const fulfilled = periodFulfilled.length;
      let totalHours = 0;
      let count = 0;
      for (const order of periodFulfilled) {
        if (order.fulfillments?.length > 0) {
          const created = new Date(order.createdAt).getTime();
          const fulfilledAt = new Date(order.fulfillments[0].createdAt).getTime();
          const hours = (fulfilledAt - created) / (1000 * 60 * 60);
          if (hours >= 0) {
            totalHours += hours;
            count++;
          }
        }
      }
      return {
        fulfilled,
        avg_fulfillment_hours: count > 0 ? Math.round((totalHours / count) * 10) / 10 : 0,
      };
    };

    const curMetrics = calcPeriodMetrics(start, end);
    const prevMetrics = calcPeriodMetrics(prevStart, prevEnd);
    const openOrders = unfulfilledOrders.length;

    let oldestUnfulfilledHours = 0;
    if (unfulfilledOrders.length > 0) {
      const oldest = unfulfilledOrders.reduce((min, o) =>
        new Date(o.createdAt) < new Date(min.createdAt) ? o : min
      );
      oldestUnfulfilledHours =
        Math.round(((now.getTime() - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60)) * 10) / 10;
    }

    return NextResponse.json({
      department: "warehouse",
      employee: { id: employee.id, name: employee.name },
      period,
      dateRange: {
        current: { from: toDateStr(start), to: toDateStr(end) },
        previous: { from: toDateStr(prevStart), to: toDateStr(prevEnd) },
      },
      metrics: {
        current: {
          open_orders: openOrders,
          fulfilled_orders: curMetrics.fulfilled,
          avg_fulfillment_hours: curMetrics.avg_fulfillment_hours,
          oldest_unfulfilled_hours: oldestUnfulfilledHours,
        },
        previous: {
          open_orders: 0,
          fulfilled_orders: prevMetrics.fulfilled,
          avg_fulfillment_hours: prevMetrics.avg_fulfillment_hours,
          oldest_unfulfilled_hours: 0,
        },
        change: {
          open_orders: null,
          fulfilled_orders: pctChange(curMetrics.fulfilled, prevMetrics.fulfilled),
          avg_fulfillment_hours: pctChange(prevMetrics.avg_fulfillment_hours, curMetrics.avg_fulfillment_hours),
          oldest_unfulfilled_hours: null,
        },
      },
    });
  }

  // --- OTHER DEPARTMENTS (customer_service, marketing, management, accounting) ---
  const { start, end, prevStart, prevEnd } = getPeriodRange(period, dateStr);

  const { data: entries } = await getSupabase()
    .from("kpi_entries")
    .select("*")
    .eq("employee_id", employeeId)
    .gte("date", toDateStr(prevStart))
    .lt("date", toDateStr(end));

  const curMetrics: Record<string, number> = {};
  const prevMetrics: Record<string, number> = {};

  for (const entry of entries ?? []) {
    const d = new Date(entry.date + "T00:00:00");
    if (d >= start && d < end) {
      curMetrics[entry.metric] = (curMetrics[entry.metric] ?? 0) + Number(entry.value);
    } else if (d >= prevStart && d < prevEnd) {
      prevMetrics[entry.metric] = (prevMetrics[entry.metric] ?? 0) + Number(entry.value);
    }
  }

  const allMetricNames = [...new Set([...Object.keys(curMetrics), ...Object.keys(prevMetrics)])];
  const change: Record<string, number | null> = {};
  for (const m of allMetricNames) {
    change[m] = pctChange(curMetrics[m] ?? 0, prevMetrics[m] ?? 0);
  }

  return NextResponse.json({
    department: employee.department,
    employee: { id: employee.id, name: employee.name },
    period,
    dateRange: {
      current: { from: toDateStr(start), to: toDateStr(end) },
      previous: { from: toDateStr(prevStart), to: toDateStr(prevEnd) },
    },
    metrics: {
      current: curMetrics,
      previous: prevMetrics,
      change,
    },
  });
}
