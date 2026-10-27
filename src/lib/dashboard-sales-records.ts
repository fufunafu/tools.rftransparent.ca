import { getSupabase } from "@/lib/supabase";
import { fetchAllPages, getStores, calcNetRevenue, type RevenueFields, type ShopifyConnection } from "@/lib/shopify";
import { dashboardSalesReps, resolveDashboardSalesAttribution, dashboardSalesSearchFilter, salesInPeriod, type DashboardSalesOrder, type DashboardSalesRecord } from "@/lib/dashboard-sales";
import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";
import { getSalesPeriod, type SalesPeriod } from "@/lib/sales-periods";
import { salesRecordCustomerName, type SalesRecordCustomer, shopifyRecordUrl, type SalesRecordList, type SalesRecordDetail } from "@/lib/sales-record-details";

import { PERFORMER_ORDERS_QUERY, PERFORMER_DRAFTS_QUERY } from "@/lib/sales-shopify-queries";
import { loadSalesMirror } from "@/lib/sales-shopify-mirror";
export { PERFORMER_ORDERS_QUERY, PERFORMER_DRAFTS_QUERY } from "@/lib/sales-shopify-queries";

type OrderRecord = DashboardSalesOrder & SalesRecordCustomer & { id: string; name: string; createdAt: string };
type QuoteRecord = DashboardSalesRecord & RevenueFields & SalesRecordCustomer & { id: string; name: string; createdAt: string; status: string };

/** Uses the same territory, tag, date and money rules as the sales dashboard. */
export async function getSalesRepRecords(repId: string, period: SalesPeriod, kind: "orders" | "quotes", options?: { fromMirror?: boolean }): Promise<SalesRecordList> {
  const { data: employees, error } = await getSupabase().from("employees")
    .select("id, name, department, shopify_tags").eq("active", true).order("name");
  if (error) throw new Error(error.message);
  const reps = dashboardSalesReps(employees ?? []);
  const rep = reps.find((entry) => entry.id === repId);
  if (!rep) throw new Error("Sales representative not found.");
  if (rep.placeholder) return { records: [], total: 0, warnings: [] };
  const store = getStores().find((entry) => entry.id === rep.storeId);
  if (!store) throw new Error("The Shopify connection is unavailable.");
  const now = new Date();
  const start = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 1 - getSalesPeriod(period).days);
  const end = new Date(now.getTime() + 1);
  const records: SalesRecordDetail[] = [];
  const warnings: string[] = [];

  if (kind === "orders") {
    const result = options?.fromMirror ? await loadSalesMirror<OrderRecord>(store.id, "order", start) : await fetchAllPages<OrderRecord, { orders: ShopifyConnection<OrderRecord> }>({
      storeId: store.id, query: PERFORMER_ORDERS_QUERY,
      variables: { filter: dashboardSalesSearchFilter(store.id, reps, `updated_at:>='${start.toISOString()}'`) },
      getConnection: (data) => data.orders, maxPages: 2000,
    });
    if (result.truncated) throw new Error("The order list is incomplete. Please try again.");
    for (const order of result.nodes) {
      const record = { ...order, storeId: store.id };
      const owner = resolveDashboardSalesAttribution(record, reps);
      if (owner.status !== "unique" || owner.employeeId !== repId) continue;
      const amount = salesInPeriod(record, start, end);
      if (Math.abs(amount) <= 0.005) continue;
      const activityDates = order.transactions.filter((transaction) => transaction.status === "SUCCESS" &&
        ["SALE", "CAPTURE", "REFUND"].includes(transaction.kind) && transaction.processedAt &&
        new Date(transaction.processedAt) >= start && new Date(transaction.processedAt) < end)
        .map((transaction) => transaction.processedAt!).sort();
      if (order.transactions.length >= 50) warnings.push("An order reached the transaction limit; its amount may be incomplete.");
      records.push({ id: order.id, name: order.name, customerName: salesRecordCustomerName(order), date: activityDates.at(-1) ?? order.createdAt,
        amount, status: amount < 0 ? "Net refund" : "Net payment", url: shopifyRecordUrl(store.store, order.id, kind) });
    }
  } else {
    const result = options?.fromMirror ? await loadSalesMirror<QuoteRecord>(store.id, "draft", start) : await fetchAllPages<QuoteRecord, { draftOrders: ShopifyConnection<QuoteRecord> }>({
      storeId: store.id, query: PERFORMER_DRAFTS_QUERY,
      variables: { filter: dashboardSalesSearchFilter(store.id, reps, `created_at:>='${start.toISOString()}'`) },
      getConnection: (data) => data.draftOrders, maxPages: 200,
    });
    if (result.truncated) throw new Error("The quote list is incomplete. Please try again.");
    for (const quote of result.nodes) {
      const owner = resolveDashboardSalesAttribution({ ...quote, storeId: store.id }, reps);
      const created = new Date(quote.createdAt);
      if (quote.status === "OPEN" || created < start || created >= end || owner.status !== "unique" || owner.employeeId !== repId) continue;
      records.push({ id: quote.id, name: quote.name, customerName: salesRecordCustomerName(quote), date: quote.createdAt, amount: calcNetRevenue(quote),
        status: quote.status === "COMPLETED" ? "Completed" : "Invoice sent", url: shopifyRecordUrl(store.store, quote.id, kind) });
    }
  }
  records.sort((a, b) => b.date.localeCompare(a.date));
  return { records, total: Math.round(records.reduce((sum, record) => sum + record.amount, 0) * 100) / 100, warnings: [...new Set(warnings)] };
}
