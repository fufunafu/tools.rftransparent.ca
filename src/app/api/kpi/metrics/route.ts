import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { shopifyGraphQL, getStores } from "@/lib/shopify";


interface OrderNode {
  createdAt: string;
  tags: string[];
  subtotalPriceSet: { shopMoney: { amount: string } };
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

interface DraftOrderNode {
  createdAt: string;
  status: string;
  tags: string[];
  subtotalPriceSet: { shopMoney: { amount: string } };
}

interface DraftOrdersResponse {
  draftOrders: {
    edges: { node: DraftOrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

function makeOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node {
            createdAt
            tags
            subtotalPriceSet { shopMoney { amount } }
          }
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

function makeDraftOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  // Note: DraftOrderSortKeys has no CREATED_AT — use UPDATED_AT for newest-first
  // pagination. We still filter by createdAt client-side for period attribution.
  return `
    query {
      draftOrders(first: 250, sortKey: UPDATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node {
            createdAt
            status
            tags
            subtotalPriceSet { shopMoney { amount } }
          }
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

type Period = "daily" | "weekly" | "monthly" | "yearly";

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
  } else if (period === "monthly") {
    start = new Date(date.getFullYear(), date.getMonth(), 1);
    end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    prevStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    prevEnd = new Date(start);
  } else {
    // yearly — rolling 12-month window ending on (and including) the selected date
    end = new Date(date);
    end.setDate(end.getDate() + 1); // exclusive end: day after selected date
    start = new Date(date);
    start.setFullYear(start.getFullYear() - 1);
    prevEnd = new Date(start);
    prevStart = new Date(start);
    prevStart.setFullYear(prevStart.getFullYear() - 1);
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

  if (!["daily", "weekly", "monthly", "yearly"].includes(period))
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
  // Tags seen on actual orders/drafts in the current period (sales only).
  // Returned to the UI so users know what to put in Shopify Tags per employee.
  let discoveredOrderTags: string[] = [];
  let discoveredDraftTags: string[] = [];
  let draftsDiagnostic: Record<string, { fetched: number; error?: string }> = {};

  // Split employees by department type
  const salesEmployees = employees.filter((e) => e.department === "sales");
  const warehouseEmployees = employees.filter((e) => e.department === "warehouse");
  const otherEmployees = employees.filter(
    (e) => e.department !== "sales" && e.department !== "warehouse"
  );

  /**
   * Returns the tags to use for matching orders to an employee.
   * Uses configured shopify_tags if set; otherwise falls back to
   * name-derived tags (first name, last name, full name).
   */
  function getMatchTags(emp: { name: string; shopify_tags?: string[] | null }): string[] {
    const configured = (emp.shopify_tags ?? [])
      .map((t: string) => t.toLowerCase())
      .filter(Boolean);
    if (configured.length > 0) return configured;
    // Name-based fallback: "Robert Glas" → ["robert glas", "robert", "glas"]
    const name = emp.name.trim().toLowerCase();
    const parts = name.split(/\s+/);
    return [...new Set([name, ...parts])];
  }

  // --- SALES: auto-calculate from Shopify (RF Transparent store only) ---
  if (salesEmployees.length > 0) {
    const stores = getStores();
    // Sales always uses RF Transparent store only
    const rfStore = stores.find((s) => s.label === "RF Transparent");
    const salesStoreIds = rfStore ? [rfStore.id] : stores.map((s) => s.id);

    const fetchDate = toDateStr(prevStart);

    // Fetch completed orders (sold)
    const allOrders: OrderNode[] = [];
    for (const store of stores) {
      if (!salesStoreIds.includes(store.id)) continue;
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
        console.error(`[KPI Metrics] Orders fetch failed for ${store.id}:`, err);
      }
    }

    // Fetch draft orders (quoted)
    const allDrafts: DraftOrderNode[] = [];
    const draftDebug: Record<string, { fetched: number; error?: string }> = {};
    for (const store of stores) {
      if (!salesStoreIds.includes(store.id)) continue;
      draftDebug[store.label] = { fetched: 0 };
      try {
        let cursor: string | undefined;
        let hasNext = true;
        let pages = 0;
        while (hasNext && pages < 20) {
          const data = await shopifyGraphQL<DraftOrdersResponse>(
            store.id,
            makeDraftOrdersQuery(fetchDate, cursor)
          );
          if (!data?.draftOrders) {
            draftDebug[store.label].error = "draftOrders field missing (scope?)";
            break;
          }
          const edges = data.draftOrders.edges;
          allDrafts.push(...edges.map((e) => e.node));
          draftDebug[store.label].fetched += edges.length;
          hasNext = data.draftOrders.pageInfo.hasNextPage;
          cursor = edges[edges.length - 1]?.cursor;
          pages++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[KPI Metrics] Drafts fetch failed for ${store.id}:`, err);
        draftDebug[store.label].error = msg;
      }
    }
    draftsDiagnostic = draftDebug;

    // Collect all tags from current-period orders/drafts so the UI can
    // surface them as a configuration hint.
    const orderTagSet = new Set<string>();
    const draftTagSet = new Set<string>();
    for (const order of allOrders) {
      if (new Date(order.createdAt) >= start && new Date(order.createdAt) < end) {
        order.tags.forEach((t) => orderTagSet.add(t));
      }
    }
    for (const draft of allDrafts) {
      if (new Date(draft.createdAt) >= start && new Date(draft.createdAt) < end) {
        draft.tags.forEach((t) => draftTagSet.add(t));
      }
    }
    discoveredOrderTags = [...orderTagSet].sort();
    discoveredDraftTags = [...draftTagSet].sort();

    // All tags that belong to known employees (for unassigned detection)
    const allKnownTags = new Set<string>();
    for (const emp of salesEmployees) {
      for (const t of getMatchTags(emp)) allKnownTags.add(t);
    }

    // Attribute to employees via tags (configured shopify_tags or name fallback)
    for (const emp of salesEmployees) {
      const empTags = getMatchTags(emp);

      let curRevenue = 0, curOrders = 0, prevRevenue = 0, prevOrders = 0;
      let curQuoted = 0, curQuotes = 0, prevQuoted = 0, prevQuotes = 0;

      for (const order of allOrders) {
        const orderDate = new Date(order.createdAt);
        const orderTags = order.tags.map((t) => t.toLowerCase());
        if (!empTags.some((et) => orderTags.includes(et))) continue;
        const amount = parseFloat(order.subtotalPriceSet.shopMoney.amount);
        if (orderDate >= start && orderDate < end) {
          curRevenue += amount;
          curOrders++;
        } else if (orderDate >= prevStart && orderDate < prevEnd) {
          prevRevenue += amount;
          prevOrders++;
        }
      }

      for (const draft of allDrafts) {
        const draftDate = new Date(draft.createdAt);
        const draftTags = draft.tags.map((t) => t.toLowerCase());
        if (!empTags.some((et) => draftTags.includes(et))) continue;
        const amount = parseFloat(draft.subtotalPriceSet?.shopMoney?.amount ?? "0");
        if (draftDate >= start && draftDate < end) {
          curQuoted += amount;
          curQuotes++;
        } else if (draftDate >= prevStart && draftDate < prevEnd) {
          prevQuoted += amount;
          prevQuotes++;
        }
      }

      const curAOV = curOrders > 0 ? curRevenue / curOrders : 0;
      const prevAOV = prevOrders > 0 ? prevRevenue / prevOrders : 0;
      const curConv = curQuoted > 0 ? (curRevenue / curQuoted) * 100 : 0;
      const prevConv = prevQuoted > 0 ? (prevRevenue / prevQuoted) * 100 : 0;

      const pctChange = (cur: number, prev: number) =>
        prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

      results.push({
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department,
        locationName: emp.locations?.name ?? "—",
        metrics: {
          current: {
            quoted: Math.round(curQuoted * 100) / 100,
            quote_count: curQuotes,
            sold: Math.round(curRevenue * 100) / 100,
            orders: curOrders,
            aov: Math.round(curAOV * 100) / 100,
            conversion_rate: Math.round(curConv * 10) / 10,
          },
          previous: {
            quoted: Math.round(prevQuoted * 100) / 100,
            quote_count: prevQuotes,
            sold: Math.round(prevRevenue * 100) / 100,
            orders: prevOrders,
            aov: Math.round(prevAOV * 100) / 100,
            conversion_rate: Math.round(prevConv * 10) / 10,
          },
          change: {
            quoted: pctChange(curQuoted, prevQuoted),
            quote_count: pctChange(curQuotes, prevQuotes),
            sold: pctChange(curRevenue, prevRevenue),
            orders: pctChange(curOrders, prevOrders),
            aov: pctChange(curAOV, prevAOV),
            conversion_rate: pctChange(curConv, prevConv),
          },
        },
      });
    }

    // --- Unassigned: orders/drafts not matched to any known employee ---
    {
      let curRevenue = 0, curOrders = 0, prevRevenue = 0, prevOrders = 0;
      let curQuoted = 0, curQuotes = 0, prevQuoted = 0, prevQuotes = 0;

      const pctChange = (cur: number, prev: number) =>
        prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

      for (const order of allOrders) {
        const orderDate = new Date(order.createdAt);
        const orderTags = order.tags.map((t) => t.toLowerCase());
        if (orderTags.some((t) => allKnownTags.has(t))) continue; // attributed
        const amount = parseFloat(order.subtotalPriceSet.shopMoney.amount);
        if (orderDate >= start && orderDate < end) {
          curRevenue += amount;
          curOrders++;
        } else if (orderDate >= prevStart && orderDate < prevEnd) {
          prevRevenue += amount;
          prevOrders++;
        }
      }

      for (const draft of allDrafts) {
        const draftDate = new Date(draft.createdAt);
        const draftTags = draft.tags.map((t) => t.toLowerCase());
        if (draftTags.some((t) => allKnownTags.has(t))) continue; // attributed
        const amount = parseFloat(draft.subtotalPriceSet?.shopMoney?.amount ?? "0");
        if (draftDate >= start && draftDate < end) {
          curQuoted += amount;
          curQuotes++;
        } else if (draftDate >= prevStart && draftDate < prevEnd) {
          prevQuoted += amount;
          prevQuotes++;
        }
      }

      if (curOrders + prevOrders + curQuotes + prevQuotes > 0) {
        const curAOV = curOrders > 0 ? curRevenue / curOrders : 0;
        const prevAOV = prevOrders > 0 ? prevRevenue / prevOrders : 0;
        const curConv = curQuoted > 0 ? (curRevenue / curQuoted) * 100 : 0;
        const prevConv = prevQuoted > 0 ? (prevRevenue / prevQuoted) * 100 : 0;
        results.push({
          employeeId: "__unassigned__",
          employeeName: "Unassigned",
          department: "sales",
          locationName: "—",
          metrics: {
            current: {
              quoted: Math.round(curQuoted * 100) / 100,
              quote_count: curQuotes,
              sold: Math.round(curRevenue * 100) / 100,
              orders: curOrders,
              aov: Math.round(curAOV * 100) / 100,
              conversion_rate: Math.round(curConv * 10) / 10,
            },
            previous: {
              quoted: Math.round(prevQuoted * 100) / 100,
              quote_count: prevQuotes,
              sold: Math.round(prevRevenue * 100) / 100,
              orders: prevOrders,
              aov: Math.round(prevAOV * 100) / 100,
              conversion_rate: Math.round(prevConv * 10) / 10,
            },
            change: {
              quoted: pctChange(curQuoted, prevQuoted),
              quote_count: pctChange(curQuotes, prevQuotes),
              sold: pctChange(curRevenue, prevRevenue),
              orders: pctChange(curOrders, prevOrders),
              aov: pctChange(curAOV, prevAOV),
              conversion_rate: pctChange(curConv, prevConv),
            },
          },
        });
      }
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
    ...(discoveredOrderTags.length > 0 || discoveredDraftTags.length > 0
      ? { discoveredTags: { orders: discoveredOrderTags, drafts: discoveredDraftTags } }
      : {}),
    ...(Object.keys(draftsDiagnostic).length > 0
      ? { draftsDiagnostic }
      : {}),
  });
}
