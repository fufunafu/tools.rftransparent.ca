import { getSupabase } from "@/lib/supabase";
import { fetchAllPages, getStores, calcNetRevenue, REVENUE_FIELDS, type RevenueFields, type ShopifyConnection } from "@/lib/shopify";
import { dashboardSalesReps, resolveDashboardSalesAttribution, dashboardSalesSearchFilter, salesInPeriod, type DashboardSalesOrder, type DashboardSalesRecord } from "@/lib/dashboard-sales";
import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";
import { getSalesPeriod, type SalesPeriod } from "@/lib/sales-periods";
import { salesRecordCustomerName, type SalesRecordCustomer, shopifyRecordUrl, type SalesRecordList, type SalesRecordDetail } from "@/lib/sales-record-details";

export const PERFORMER_ORDERS_QUERY = `
  query($after: String, $filter: String!) {
    orders(first: 25, after: $after, query: $filter, sortKey: UPDATED_AT) {
      edges {
        node {
          id name createdAt
          customer { firstName lastName }
          tags
          shippingAddress { provinceCode province countryCodeV2 name company }
          billingAddress { provinceCode province countryCodeV2 name company }
          currentTotalPriceSet { shopMoney { amount } }
          currentTotalTaxSet { shopMoney { amount } }
          currentShippingPriceSet { shopMoney { amount } }
          totalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          transactions(first: 50) {
            kind status processedAt amountSet { shopMoney { amount } }
          }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

export const PERFORMER_DRAFTS_QUERY = `
  query($after: String, $filter: String!) {
    draftOrders(first: 250, after: $after, query: $filter) {
      edges {
        node {
          id name createdAt status tags ${REVENUE_FIELDS}
          customer { firstName lastName }
          shippingAddress { provinceCode province countryCodeV2 name company }
          billingAddress { provinceCode province countryCodeV2 name company }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

type OrderRecord = DashboardSalesOrder & SalesRecordCustomer & { id: string; name: string; createdAt: string };
type QuoteRecord = DashboardSalesRecord & RevenueFields & SalesRecordCustomer & { id: string; name: string; createdAt: string; status: string };

/** Uses the same territory, tag, date and money rules as the sales dashboard. */
export async function getSalesRepRecords(repId: string, period: SalesPeriod, kind: "orders" | "quotes"): Promise<SalesRecordList> {
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
    const result = await fetchAllPages<OrderRecord, { orders: ShopifyConnection<OrderRecord> }>({
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
    const result = await fetchAllPages<QuoteRecord, { draftOrders: ShopifyConnection<QuoteRecord> }>({
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
