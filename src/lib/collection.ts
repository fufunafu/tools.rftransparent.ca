import { shopifyGraphQL, calcNetRevenue, REVENUE_FIELDS, type RevenueFields } from "@/lib/shopify";

// Unpaid (receivables) orders for one store. Lives here — not inside the
// accounting route — because two consumers need identical numbers: the
// Accounting page (session-gated API) and the wall board (token-authed, no
// session). When this was only reachable through the API, the wall could
// show collection solely while someone's dashboard visit kept a shared
// cache warm, which on an always-on TV meant "usually blank".

export interface UnpaidOrderRow {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  customer: string;
  amount: number;
  currency: string;
  daysPending: number;
}

interface UnpaidNode extends RevenueFields {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentSubtotalPriceSet: { shopMoney: { amount: string } } | null;
  customer: { firstName: string; lastName: string } | null;
}

// Cancelled orders keep their pending financial status forever, so without
// the -status:cancelled clause the receivables list slowly fills with orders
// nobody expects to collect. cancelledAt is selected too as belt-and-braces
// for search-syntax quirks.
const UNPAID_QUERY = `
  query {
    orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "(financial_status:pending OR financial_status:partially_paid) AND -status:cancelled") {
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          currentSubtotalPriceSet { shopMoney { amount } }
          ${REVENUE_FIELDS}
          customer { firstName lastName }
        }
      }
    }
  }
`;

export async function fetchUnpaidOrders(storeId: string): Promise<UnpaidOrderRow[]> {
  const data = await shopifyGraphQL<{ orders: { edges: { node: UnpaidNode }[] } }>(
    storeId,
    UNPAID_QUERY
  );

  return data.orders.edges
    .filter((e) => !e.node.cancelledAt)
    .map((e) => ({
      id: e.node.id,
      name: e.node.name,
      createdAt: e.node.createdAt,
      financialStatus: e.node.displayFinancialStatus,
      // Company customers often have no first name; template-literalling the
      // null once produced customers literally called "null Skyline Glass
      // and Mirror". Join whichever halves exist.
      customer:
        [e.node.customer?.firstName, e.node.customer?.lastName]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(" ") || "Guest",
      // The CURRENT subtotal — after edits and removed items — not the
      // original, which showed a $0 order as $353 outstanding.
      amount: calcNetRevenue({
        ...e.node,
        subtotalPriceSet: e.node.currentSubtotalPriceSet ?? e.node.subtotalPriceSet,
      }),
      currency: e.node.totalPriceSet.shopMoney.currencyCode,
      daysPending: Math.floor(
        (Date.now() - new Date(e.node.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));
}
