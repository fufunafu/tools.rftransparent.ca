import { expect, it } from "vitest";
import { getSalesPeriod, parseSalesPeriod, SALES_PERIODS } from "./sales-periods";

it("accepts supported date ranges and defaults invalid URL values to 30 days", () => {
  for (const period of SALES_PERIODS) {
    expect(parseSalesPeriod(period.id)).toBe(period.id);
    expect(getSalesPeriod(period.id).days).toBe(period.days);
  }
  for (const value of [undefined, "all", "__proto__", ["7d", "1y"]]) {
    expect(parseSalesPeriod(value)).toBe("30d");
  }
});
