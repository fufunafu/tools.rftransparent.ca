import { describe, expect, it } from "vitest";
import { validateWarehouseReport } from "@/lib/warehouse-report";

const valid = {
  report_date: "2026-08-13",
  boxes_built: 12,
  orders_packed: 8,
  walkin_pickup: 3,
  notes: "  Smooth shift  ",
};

describe("validateWarehouseReport", () => {
  it("normalizes a valid frontline report", () => {
    expect(validateWarehouseReport(valid)).toEqual({
      ok: true,
      value: {
        reportDate: "2026-08-13",
        boxesBuilt: 12,
        ordersPacked: 8,
        walkinPickup: 3,
        notes: "Smooth shift",
      },
    });
  });

  it.each(["employee_id", "employeeId"])("rejects the client identity field %s", (field) => {
    const result = validateWarehouseReport({ ...valid, [field]: "other-employee" });
    expect(result).toEqual({
      ok: false,
      error: "Employee identity must not be supplied by the client",
    });
  });

  it.each([
    { report_date: "2026-02-30" },
    { boxes_built: -1 },
    { orders_packed: 1.5 },
    { walkin_pickup: Number.POSITIVE_INFINITY },
    { notes: "x".repeat(2_001) },
  ])("rejects invalid report values", (override) => {
    expect(validateWarehouseReport({ ...valid, ...override }).ok).toBe(false);
  });
});
