import { describe, expect, it } from "vitest";
import {
  buildEmployeePerformance,
  getPerformanceWindow,
  performanceQueryStart,
  type EmployeePerformanceInput,
  type PerformanceEmployeeRow,
  type PerformanceQuoteRow,
} from "@/lib/employee-performance";

const NOW = new Date("2026-08-04T18:00:00.000Z");

function employee(
  id: string,
  name: string,
  department: string,
  overrides: Partial<PerformanceEmployeeRow> = {},
): PerformanceEmployeeRow {
  return {
    id,
    name,
    email: `${id}@example.com`,
    email_alt: null,
    department,
    shopify_tags: [],
    active: true,
    location_id: null,
    locations: null,
    ...overrides,
  };
}

function quote(id: string, overrides: Partial<PerformanceQuoteRow> = {}): PerformanceQuoteRow {
  return {
    id,
    draft_name: `#${id}`,
    customer_email: `${id}@customer.com`,
    customer_phone: "+1 780 555 0101",
    quote_amount: 1000,
    shopify_status: "INVOICE_SENT",
    lead_status: "new",
    next_followup_at: null,
    closed_at: null,
    shopify_created_at: "2026-08-04T16:00:00.000Z",
    first_synced_at: "2026-08-04T16:00:00.000Z",
    last_invoice_sender: "Shanaz Rohoman",
    created_by_staff: null,
    ...overrides,
  };
}

function input(overrides: Partial<EmployeePerformanceInput> = {}): EmployeePerformanceInput {
  return {
    employees: [
      employee("shanaz", "Shanaz Rohoman", "customer_service"),
      employee("ben", "Benjamin Dundas", "customer_service"),
      employee("warehouse-a", "Warehouse A", "warehouse", { locations: { name: "Toronto" } }),
      employee("warehouse-b", "Warehouse B", "warehouse", { locations: { name: "Toronto" } }),
    ],
    quotes: [],
    followups: [],
    leads: [],
    leadCalls: [],
    phoneCalls: [],
    warehouseReports: [],
    ...overrides,
  };
}

describe("employee performance ranges", () => {
  it("builds current and previous rolling day windows in Toronto", () => {
    expect(getPerformanceWindow("7d", NOW)).toMatchObject({
      currentStart: 20663,
      currentEnd: 20669,
      previousStart: 20656,
      previousEnd: 20662,
    });
  });

  it("includes a 30-day call lookback before the previous period", () => {
    expect(performanceQueryStart("today", NOW)).toBe("2026-07-03T00:00:00.000Z");
    expect(performanceQueryStart("all", NOW)).toBeNull();
  });
});

describe("buildEmployeePerformance", () => {
  it("attributes quotes and follow-ups, then measures recorded calls before quotes", () => {
    const result = buildEmployeePerformance(input({
      quotes: [
        quote("called", { lead_status: "won" }),
        quote("not-called", {
          customer_phone: "+1 780 555 0102",
          quote_amount: 2500,
        }),
      ],
      followups: [
        {
          id: "followup",
          lead_id: "called",
          logged_by: "shanaz@example.com",
          created_at: "2026-08-04T17:00:00.000Z",
        },
      ],
      phoneCalls: [
        {
          id: "call",
          call_start: "2026-08-04T15:00:00.000Z",
          from_number: "store",
          to_number: "7805550101",
          direction: "outbound",
          duration_min: 0,
          endpoint: "206",
        },
      ],
    }), "today", NOW);

    const shanaz = result.employees.find((row) => row.employee.id === "shanaz")!;
    expect(shanaz.metrics).toMatchObject({
      quotes_sent: 2,
      quoted_value: 3500,
      won_quotes: 1,
      conversion_rate: 50,
      followups_completed: 1,
      called_before_quote: 1,
      no_call_before_quote: 1,
      call_before_quote_rate: 50,
    });
    expect(result.dataQuality).toMatchObject({ matchedQuotes: 2, unattributedQuotes: 0 });
  });

  it("matches common staff labels by unique first name", () => {
    const result = buildEmployeePerformance(input({
      quotes: [quote("jun", {
        last_invoice_sender: "Jun reception estimate quote",
        created_by_staff: null,
      })],
      employees: [employee("jun", "Jun Gao", "customer_service")],
    }), "today", NOW);

    expect(result.employees[0].metrics.quotes_sent).toBe(1);
  });

  it("falls back to the quote creator when the last sender is blank", () => {
    const result = buildEmployeePerformance(input({
      quotes: [quote("creator", {
        last_invoice_sender: "   ",
        created_by_staff: "Benjamin Dundas",
      })],
    }), "today", NOW);

    expect(result.employees.find((row) => row.employee.id === "ben")?.metrics.quotes_sent).toBe(1);
  });

  it("counts manual lead calls by matching customer email when no phone is present", () => {
    const result = buildEmployeePerformance(input({
      quotes: [quote("email-call", {
        customer_phone: null,
        customer_email: "customer@example.com",
      })],
      leads: [{ id: "lead", email: "customer@example.com", phone: null }],
      leadCalls: [{
        id: "attempt",
        lead_id: "lead",
        called_at: "2026-08-04T15:00:00.000Z",
      }],
    }), "today", NOW);

    expect(result.employees.find((row) => row.employee.id === "shanaz")?.metrics.called_before_quote).toBe(1);
  });

  it("aggregates individual warehouse reports and compares with the department median", () => {
    const result = buildEmployeePerformance(input({
      warehouseReports: [
        {
          employee_id: "warehouse-a",
          report_date: "2026-08-04",
          boxes_built: 10,
          orders_packed: 6,
          walkin_pickup: 2,
        },
        {
          employee_id: "warehouse-a",
          report_date: "2026-08-03",
          boxes_built: 8,
          orders_packed: 4,
          walkin_pickup: 0,
        },
        {
          employee_id: "warehouse-b",
          report_date: "2026-08-04",
          boxes_built: 4,
          orders_packed: 2,
          walkin_pickup: 0,
        },
      ],
    }), "7d", NOW);

    const warehouseA = result.employees.find((row) => row.employee.id === "warehouse-a")!;
    expect(warehouseA.metrics).toMatchObject({
      report_days: 2,
      boxes_built: 18,
      orders_packed: 10,
      walkin_pickup: 2,
      total_units: 30,
      units_per_report_day: 15,
    });
    expect(warehouseA.departmentMedian.total_units).toBe(18);
  });

  it("compares warehouse employees only with peers at the same location", () => {
    const result = buildEmployeePerformance(input({
      employees: [
        employee("warehouse-a", "Warehouse A", "warehouse", { locations: { name: "Toronto" } }),
        employee("warehouse-b", "Warehouse B", "warehouse", { locations: { name: "Montreal" } }),
      ],
      warehouseReports: [
        {
          employee_id: "warehouse-a",
          report_date: "2026-08-04",
          boxes_built: 10,
          orders_packed: 0,
          walkin_pickup: 0,
        },
        {
          employee_id: "warehouse-b",
          report_date: "2026-08-04",
          boxes_built: 100,
          orders_packed: 0,
          walkin_pickup: 0,
        },
      ],
    }), "today", NOW);

    expect(result.employees.find((row) => row.employee.id === "warehouse-a")?.departmentMedian.total_units).toBe(10);
  });

  it("keeps previous-period values separate and omits all-time changes", () => {
    const recent = buildEmployeePerformance(input({
      quotes: [
        quote("current"),
        quote("previous", { shopify_created_at: "2026-08-03T16:00:00.000Z" }),
      ],
    }), "today", NOW);
    const shanazRecent = recent.employees.find((row) => row.employee.id === "shanaz")!;
    expect(shanazRecent.metrics.quotes_sent).toBe(1);
    expect(shanazRecent.previous.quotes_sent).toBe(1);

    const allTime = buildEmployeePerformance(input({ quotes: [quote("all")] }), "all", NOW);
    expect(allTime.employees.find((row) => row.employee.id === "shanaz")?.change.quotes_sent).toBeNull();
  });
});
