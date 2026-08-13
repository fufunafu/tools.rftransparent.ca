// Sales commission math, computed from Shopify payment transactions.
//
// Commission is cash-basis: a rep earns their rate on money actually collected
// (successful SALE and CAPTURE transactions) minus refunds, with taxes and
// shipping excluded. AUTHORIZATION transactions are holds — money reserved on
// the customer's card, not received — and never count; a store audit found a
// third-party export paying commission on them, which this module exists to
// prevent.
//
// Taxes and shipping are deducted proportionally per transaction:
// each payment contributes amount x (1 - ratio) where
// ratio = (current tax + current shipping) / current order total.
// Summed over an order's lifetime this equals collected - tax - shipping -
// refunds, and it splits fairly across months for orders paid in
// installments. A refund claws back its tax share by the same ratio in the
// month the refund happened.

export interface CommissionTransaction {
  kind: string; // SALE | CAPTURE | REFUND | AUTHORIZATION | VOID | ...
  status: string; // SUCCESS | PENDING | FAILURE | ...
  processedAt: string; // ISO timestamp (UTC)
  amount: number; // shop-currency amount, positive as reported by Shopify
}

export interface CommissionOrder {
  name: string;
  total: number; // current order total (after edits)
  tax: number; // current total tax
  shipping: number; // current shipping charged to the customer
  transactions: CommissionTransaction[];
}

export interface MonthlyCommission {
  month: string; // "2026-05"
  collected: number;
  net: number;
  commission: number;
  orderCount: number;
  refundCount: number;
}

export const STORE_TIME_ZONE = "America/Toronto";

const POSITIVE_KINDS = new Set(["SALE", "CAPTURE"]);

// Formatter cache — Intl.DateTimeFormat construction is expensive in loops.
const monthFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-05" for a UTC timestamp, in the store's local calendar. */
export function monthKey(isoTimestamp: string, timeZone = STORE_TIME_ZONE): string {
  let fmt = monthFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    });
    monthFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(isoTimestamp));
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

/** Share of an order's total that is tax + shipping (0 when the total is 0). */
export function deductionRatio(order: Pick<CommissionOrder, "total" | "tax" | "shipping">): number {
  if (!(order.total > 0)) return 0;
  return Math.min(1, Math.max(0, (order.tax + order.shipping) / order.total));
}

interface MonthAccumulator {
  collected: number;
  net: number;
  orders: Set<string>;
  refunds: number;
}

/**
 * Aggregate one rep's orders into monthly commission for a calendar year.
 * `orders` must already be attributed to the rep (see sales-attribution.ts).
 */
export function computeMonthlyCommission(
  orders: CommissionOrder[],
  rate: number,
  year: number,
  timeZone = STORE_TIME_ZONE
): MonthlyCommission[] {
  const byMonth = new Map<string, MonthAccumulator>();

  for (const order of orders) {
    const ratio = deductionRatio(order);
    for (const tx of order.transactions) {
      if (tx.status !== "SUCCESS") continue;
      const positive = POSITIVE_KINDS.has(tx.kind);
      const refund = tx.kind === "REFUND";
      if (!positive && !refund) continue; // AUTHORIZATION, VOID, etc.

      const month = monthKey(tx.processedAt, timeZone);
      if (!month.startsWith(`${year}-`)) continue;

      const signed = refund ? -tx.amount : tx.amount;
      let acc = byMonth.get(month);
      if (!acc) {
        acc = { collected: 0, net: 0, orders: new Set(), refunds: 0 };
        byMonth.set(month, acc);
      }
      acc.collected += signed;
      acc.net += signed * (1 - ratio);
      acc.orders.add(order.name);
      if (refund) acc.refunds += 1;
    }
  }

  const months: MonthlyCommission[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    const acc = byMonth.get(key);
    months.push({
      month: key,
      collected: round2(acc?.collected ?? 0),
      net: round2(acc?.net ?? 0),
      commission: round2((acc?.net ?? 0) * rate),
      orderCount: acc?.orders.size ?? 0,
      refundCount: acc?.refunds ?? 0,
    });
  }
  return months;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
