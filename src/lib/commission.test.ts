import { describe, expect, it } from "vitest";
import {
  computeMonthlyCommission,
  deductionRatio,
  monthKey,
  type CommissionOrder,
} from "./commission";

function order(partial: Partial<CommissionOrder>): CommissionOrder {
  return {
    name: "#1",
    total: 1130,
    tax: 130,
    shipping: 0,
    transactions: [],
    ...partial,
  };
}

describe("monthKey", () => {
  it("buckets by the store's local calendar, not UTC", () => {
    // 03:59 UTC on June 1 is still 23:59 on May 31 in Toronto (UTC-4).
    expect(monthKey("2026-06-01T03:59:00Z")).toBe("2026-05");
    expect(monthKey("2026-06-01T04:00:00Z")).toBe("2026-06");
  });
});

describe("deductionRatio", () => {
  it("is the tax+shipping share of the order total", () => {
    expect(deductionRatio({ total: 1130, tax: 113, shipping: 17 })).toBeCloseTo(0.11504, 4);
  });

  it("is 0 for zero-total orders", () => {
    expect(deductionRatio({ total: 0, tax: 10, shipping: 0 })).toBe(0);
  });
});

describe("computeMonthlyCommission", () => {
  it("pays on captures, never on authorization holds (export-bug regression)", () => {
    // Real case: the hold was authorized at $10,108.38 but only $9,447.08 was
    // captured. Commission must be paid on the capture alone.
    const months = computeMonthlyCommission(
      [
        order({
          total: 9447.08,
          tax: 0,
          shipping: 1.37,
          transactions: [
            { kind: "AUTHORIZATION", status: "SUCCESS", processedAt: "2026-05-18T12:04:31Z", amount: 10108.38 },
            { kind: "CAPTURE", status: "SUCCESS", processedAt: "2026-05-18T12:04:35Z", amount: 9447.08 },
          ],
        }),
      ],
      0.05,
      2026
    );
    const may = months.find((m) => m.month === "2026-05")!;
    expect(may.collected).toBe(9447.08);
    expect(may.commission).toBeCloseTo(472.29, 1);
    expect(months.filter((m) => m.commission !== 0)).toHaveLength(1);
  });

  it("ignores failed transactions", () => {
    const months = computeMonthlyCommission(
      [
        order({
          transactions: [
            { kind: "SALE", status: "FAILURE", processedAt: "2026-03-10T15:00:00Z", amount: 1130 },
          ],
        }),
      ],
      0.05,
      2026
    );
    expect(months.every((m) => m.commission === 0)).toBe(true);
  });

  it("deducts tax proportionally and claws refunds back in their own month", () => {
    // Paid $1,130 (incl. $130 tax) in April; $113 refunded in May.
    const months = computeMonthlyCommission(
      [
        order({
          total: 1130,
          tax: 130,
          shipping: 0,
          transactions: [
            { kind: "SALE", status: "SUCCESS", processedAt: "2026-04-16T17:45:00Z", amount: 1130 },
            { kind: "REFUND", status: "SUCCESS", processedAt: "2026-05-05T13:06:00Z", amount: 113 },
          ],
        }),
      ],
      0.05,
      2026
    );
    const april = months.find((m) => m.month === "2026-04")!;
    const may = months.find((m) => m.month === "2026-05")!;
    expect(april.net).toBeCloseTo(1000, 1);
    expect(may.net).toBeCloseTo(-100, 1);
    expect(may.refundCount).toBe(1);
    // Lifetime: collected 1017 minus its tax share = 900 net → $45 at 5%.
    expect(april.commission + may.commission).toBeCloseTo(45, 1);
  });

  it("splits installments across the months each payment landed", () => {
    const months = computeMonthlyCommission(
      [
        order({
          total: 2260,
          tax: 260,
          shipping: 0,
          transactions: [
            { kind: "SALE", status: "SUCCESS", processedAt: "2026-04-28T12:00:00Z", amount: 1130 },
            { kind: "SALE", status: "SUCCESS", processedAt: "2026-05-20T12:00:00Z", amount: 1130 },
          ],
        }),
      ],
      0.05,
      2026
    );
    const april = months.find((m) => m.month === "2026-04")!;
    const may = months.find((m) => m.month === "2026-05")!;
    expect(april.net).toBeCloseTo(1000, 1);
    expect(may.net).toBeCloseTo(1000, 1);
  });

  it("excludes transactions outside the requested year", () => {
    const months = computeMonthlyCommission(
      [
        order({
          transactions: [
            { kind: "SALE", status: "SUCCESS", processedAt: "2025-12-31T12:00:00Z", amount: 1130 },
          ],
        }),
      ],
      0.05,
      2026
    );
    expect(months.every((m) => m.collected === 0)).toBe(true);
  });
});
