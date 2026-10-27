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
        employeeId: null,
        reportDate: "2026-08-13",
        boxesBuilt: 12,
        ordersPacked: 8,
        walkinPickup: 3,
        notes: "Smooth shift",
      },
    });
  });

  it("passes through a selected employee identity", () => {
    const result = validateWarehouseReport({ ...valid, employee_id: "other-employee" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.employeeId).toBe("other-employee");
  });

  it("rejects a non-string employee identity", () => {
    expect(validateWarehouseReport({ ...valid, employee_id: 42 })).toEqual({
      ok: false,
      error: "employee_id must be an employee id",
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
