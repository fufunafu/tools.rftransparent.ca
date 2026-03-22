import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { shopifyGraphQL, getStores, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";


interface OrderNode extends RevenueFields {
  createdAt: string;
  tags: string[];
}

interface FulfillmentOrderNode {
  createdAt: string;
  displayFulfillmentStatus: string;
  fulfillments: { createdAt: string }[];
}

interface OrdersResponse {
  orders: {
    edges: { node: OrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

interface FulfillmentOrdersResponse {
  orders: {
    edges: { node: FulfillmentOrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

function makeOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node { createdAt tags ${REVENUE_FIELDS} }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
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

type Period = "daily" | "weekly" | "monthly";

function getPeriodRange(
  period: Period,
  dateStr: string
): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const date = new Date(dateStr + "T00:00:00");
  let start: Date, end: Date, prevStart: Date, prevEnd: Date;

  if (period === "daily") {
    start = new Date(date);
    end = new Date(date);
    end.setDate(end.getDate() + 1);
    prevStart = new Date(date);
    prevStart.setDate(prevStart.getDate() - 1);
    prevEnd = new Date(date);
  } else if (period === "weekly") {
    const day = date.getDay();
    start = new Date(date);
    start.setDate(start.getDate() - day); // Sunday
    end = new Date(start);
    end.setDate(end.getDate() + 7);
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(start);
  } else {
    // monthly
    start = new Date(date.getFullYear(), date.getMonth(), 1);
    end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    prevStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    prevEnd = new Date(start);
  }

  return { start, end, prevStart, prevEnd };
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

interface EmployeeMetrics {
  employeeId: string;
  employeeName: string;
  department: string;
  locationName: string;
  metrics: {
    current: Record<string, number>;
    previous: Record<string, number>;
    change: Record<string, number | null>;
  };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = (req.nextUrl.searchParams.get("period") || "daily") as Period;
  const dateStr =
    req.nextUrl.searchParams.get("date") || toDateStr(new Date());
  const department = req.nextUrl.searchParams.get("department");
  const locationId = req.nextUrl.searchParams.get("locationId");
  const employeeId = req.nextUrl.searchParams.get("employeeId");

  if (!["daily", "weekly", "monthly"].includes(period))
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });

  const { start, end, prevStart, prevEnd } = getPeriodRange(period, dateStr);

  // Fetch employees
  let empQuery = getSupabase()
    .from("employees")
    .select("*, locations(id, name, shopify_store_ids)")
    .eq("active", true)
    .order("name");

  if (department) empQuery = empQuery.eq("department", department);
  if (locationId) empQuery = empQuery.eq("location_id", locationId);
  if (employeeId) empQuery = empQuery.eq("id", employeeId);

  const { data: employees, error: empError } = await empQuery;
  if (empError)
    return NextResponse.json({ error: empError.message }, { status: 500 });
  if (!employees || employees.length === 0)
    return NextResponse.json({ employees: [], summary: {} });

  const results: EmployeeMetrics[] = [];

  // Split employees by department type
  const salesEmployees = employees.filter((e) => e.department === "sales");
  const warehouseEmployees = employees.filter((e) => e.department === "warehouse");
  const otherEmployees = employees.filter(
    (e) => e.department !== "sales" && e.department !== "warehouse"
  );

  // --- SALES: auto-calculate from Shopify ---
  if (salesEmployees.length > 0) {
    // Build a map from lowercase tag → employee for fast lookup
    const tagToEmployee = new Map<
      string,
      (typeof salesEmployees)[0]
    >();
    for (const emp of salesEmployees) {
      const tags: string[] = emp.shopify_tags ?? [];
      for (const t of tags) {
        if (t) tagToEmployee.set(t.toLowerCase(), emp);
      }
    }

    // Fetch orders from all stores for the full range (prev + current)
    const allOrders: OrderNode[] = [];
    const stores = getStores();

    // Determine which stores are relevant based on location filter
    const relevantStoreIds = locationId
      ? employees
          .flatMap((e) => e.locations?.shopify_store_ids ?? [])
          .filter((v, i, a) => a.indexOf(v) === i)
      : stores.map((s) => s.id);

    const fetchDate = toDateStr(prevStart);

    for (const store of stores) {
      if (!relevantStoreIds.includes(store.id)) continue;
      try {
        let cursor: string | undefined;
        let hasNext = true;
        let pages = 0;
        while (hasNext && pages < 20) {
          const data = await shopifyGraphQL<OrdersResponse>(
            store.id,
            makeOrdersQuery(fetchDate, cursor)
          );
          const edges = data.orders.edges;
          allOrders.push(...edges.map((e) => e.node));
          hasNext = data.orders.pageInfo.hasNextPage;
          cursor = edges[edges.length - 1]?.cursor;
          pages++;
        }
      } catch (err) {
        console.error(
          `[KPI Metrics] Shopify fetch failed for ${store.id}:`,
          err
        );
      }
    }

    // Attribute orders to employees via tags (match any alias)
    for (const emp of salesEmployees) {
      const empTags: string[] = (emp.shopify_tags ?? []).map((t: string) => t.toLowerCase()).filter(Boolean);
      if (empTags.length === 0) continue;

      let curRevenue = 0,
        curOrders = 0,
        prevRevenue = 0,
        prevOrders = 0;

      for (const order of allOrders) {
        const orderDate = new Date(order.createdAt);
        const orderTags = order.tags.map((t) => t.toLowerCase());
        if (!empTags.some((et) => orderTags.includes(et))) continue;

        const amount = calcNetRevenue(order);

        if (orderDate >= start && orderDate < end) {
          curRevenue += amount;
          curOrders++;
        } else if (orderDate >= prevStart && orderDate < prevEnd) {
          prevRevenue += amount;
          prevOrders++;
        }
      }

      const curAOV = curOrders > 0 ? curRevenue / curOrders : 0;
      const prevAOV = prevOrders > 0 ? prevRevenue / prevOrders : 0;

      const pctChange = (cur: number, prev: number) =>
        prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

      results.push({
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department,
        locationName: emp.locations?.name ?? "—",
        metrics: {
          current: {
            revenue: Math.round(curRevenue * 100) / 100,
            orders: curOrders,
            aov: Math.round(curAOV * 100) / 100,
          },
          previous: {
            revenue: Math.round(prevRevenue * 100) / 100,
            orders: prevOrders,
            aov: Math.round(prevAOV * 100) / 100,
          },
          change: {
            revenue: pctChange(curRevenue, prevRevenue),
            orders: pctChange(curOrders, prevOrders),
            aov: pctChange(curAOV, prevAOV),
          },
        },
      });
    }
  }

  // --- WAREHOUSE: auto-calculate from Shopify fulfillment data ---
  if (warehouseEmployees.length > 0) {
    // Group warehouse employees by location
    const locationGroups = new Map<string, typeof warehouseEmployees>();
    for (const emp of warehouseEmployees) {
      const locId = emp.location_id ?? "no_location";
      const group = locationGroups.get(locId) ?? [];
      group.push(emp);
      locationGroups.set(locId, group);
    }

    const stores = getStores();
    const now = new Date();

    for (const [locId, locEmployees] of locationGroups) {
      // Determine which stores to query based on location
      const locStoreIds =
        locId !== "no_location"
          ? locEmployees[0]?.locations?.shopify_store_ids ?? []
          : stores.map((s) => s.id);

      // Fetch fulfilled orders for current + previous period
      const fulfilledOrders: FulfillmentOrderNode[] = [];
      const fetchDate = toDateStr(prevStart);

      for (const store of stores) {
        if (!locStoreIds.includes(store.id)) continue;
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
          console.error(`[KPI Warehouse] Fulfilled fetch failed for ${store.id}:`, err);
        }
      }

      // Fetch unfulfilled orders (current backlog)
      const unfulfilledOrders: FulfillmentOrderNode[] = [];
      for (const store of stores) {
        if (!locStoreIds.includes(store.id)) continue;
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
          console.error(`[KPI Warehouse] Unfulfilled fetch failed for ${store.id}:`, err);
        }
      }

      // Calculate metrics for current and previous periods
      const calcPeriodMetrics = (periodStart: Date, periodEnd: Date) => {
        const periodFulfilled = fulfilledOrders.filter((o) => {
          const d = new Date(o.createdAt);
          return d >= periodStart && d < periodEnd;
        });

        const fulfilled = periodFulfilled.length;

        // Average fulfillment time (hours from order creation to first fulfillment)
        let totalFulfillmentHours = 0;
        let fulfillmentCount = 0;
        for (const order of periodFulfilled) {
          if (order.fulfillments?.length > 0) {
            const created = new Date(order.createdAt).getTime();
            const fulfilledAt = new Date(order.fulfillments[0].createdAt).getTime();
            const hours = (fulfilledAt - created) / (1000 * 60 * 60);
            if (hours >= 0) {
              totalFulfillmentHours += hours;
              fulfillmentCount++;
            }
          }
        }
        const avgFulfillmentHours =
          fulfillmentCount > 0
            ? Math.round((totalFulfillmentHours / fulfillmentCount) * 10) / 10
            : 0;

        return { fulfilled, avg_fulfillment_hours: avgFulfillmentHours };
      };

      const curMetrics = calcPeriodMetrics(start, end);
      const prevMetrics = calcPeriodMetrics(prevStart, prevEnd);

      // Open orders (current snapshot)
      const openOrders = unfulfilledOrders.length;

      // Oldest unfulfilled order age in hours
      let oldestUnfulfilledHours = 0;
      if (unfulfilledOrders.length > 0) {
        const oldest = unfulfilledOrders.reduce((min, o) =>
          new Date(o.createdAt) < new Date(min.createdAt) ? o : min
        );
        oldestUnfulfilledHours =
          Math.round(((now.getTime() - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60)) * 10) / 10;
      }

      const pctChange = (cur: number, prev: number) =>
        prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

      // Assign same metrics to all warehouse employees at this location
      for (const emp of locEmployees) {
        results.push({
          employeeId: emp.id,
          employeeName: emp.name,
          department: emp.department,
          locationName: emp.locations?.name ?? "—",
          metrics: {
            current: {
              open_orders: openOrders,
              fulfilled_orders: curMetrics.fulfilled,
              avg_fulfillment_hours: curMetrics.avg_fulfillment_hours,
              oldest_unfulfilled_hours: oldestUnfulfilledHours,
            },
            previous: {
              open_orders: 0, // snapshot metric, no previous
              fulfilled_orders: prevMetrics.fulfilled,
              avg_fulfillment_hours: prevMetrics.avg_fulfillment_hours,
              oldest_unfulfilled_hours: 0,
            },
            change: {
              open_orders: null, // snapshot, no comparison
              fulfilled_orders: pctChange(curMetrics.fulfilled, prevMetrics.fulfilled),
              avg_fulfillment_hours: pctChange(
                prevMetrics.avg_fulfillment_hours, // reversed: lower is better
                curMetrics.avg_fulfillment_hours
              ),
              oldest_unfulfilled_hours: null, // snapshot
            },
          },
        });
      }
    }
  }

  // --- OTHER DEPARTMENTS: read from kpi_entries ---
  if (otherEmployees.length > 0) {
    const empIds = otherEmployees.map((e) => e.id);

    const { data: entries } = await getSupabase()
      .from("kpi_entries")
      .select("*")
      .in("employee_id", empIds)
      .gte("date", toDateStr(prevStart))
      .lt("date", toDateStr(end));

    for (const emp of otherEmployees) {
      const empEntries = (entries ?? []).filter(
        (e) => e.employee_id === emp.id
      );

      const curEntries = empEntries.filter((e) => {
        const d = new Date(e.date + "T00:00:00");
        return d >= start && d < end;
      });
      const prevEntries = empEntries.filter((e) => {
        const d = new Date(e.date + "T00:00:00");
        return d >= prevStart && d < prevEnd;
      });

      // Aggregate by metric name
      const curMetrics: Record<string, number> = {};
      const prevMetrics: Record<string, number> = {};

      for (const entry of curEntries) {
        curMetrics[entry.metric] =
          (curMetrics[entry.metric] ?? 0) + Number(entry.value);
      }
      for (const entry of prevEntries) {
        prevMetrics[entry.metric] =
          (prevMetrics[entry.metric] ?? 0) + Number(entry.value);
      }

      const allMetricNames = [
        ...new Set([
          ...Object.keys(curMetrics),
          ...Object.keys(prevMetrics),
        ]),
      ];
      const change: Record<string, number | null> = {};
      for (const m of allMetricNames) {
        const cur = curMetrics[m] ?? 0;
        const prev = prevMetrics[m] ?? 0;
        change[m] = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
      }

      results.push({
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department,
        locationName: emp.locations?.name ?? "—",
        metrics: {
          current: curMetrics,
          previous: prevMetrics,
          change,
        },
      });
    }
  }

  // Summary totals
  const summary: Record<string, number> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.metrics.current)) {
      summary[k] = (summary[k] ?? 0) + v;
    }
  }

  return NextResponse.json({
    employees: results,
    summary,
    period,
    dateRange: {
      current: { from: toDateStr(start), to: toDateStr(end) },
      previous: { from: toDateStr(prevStart), to: toDateStr(prevEnd) },
    },
  });
}
