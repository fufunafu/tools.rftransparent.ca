import { describe, expect, it } from "vitest";
import {
  dashboardSalesReps,
  resolveDashboardSalesAttribution,
  salesInPeriod,
  type DashboardSalesOrder,
  type DashboardSalesRecord,
} from "./dashboard-sales";

const employees = [
  { id: "rob", name: "Robert Glas", department: "sales", shopify_tags: ["Rob"] },
  { id: "daniel", name: "Daniel Boudreau", department: "sales", shopify_tags: [] },
  { id: "craig", name: "Craig Scarr", department: "sales", shopify_tags: [] },
  { id: "marie", name: "Marie Gauthier", department: "sales", shopify_tags: ["marie"] },
  { id: "former", name: "Andrea Carmichael", department: "sales", shopify_tags: ["andrea"] },
];
const reps = dashboardSalesReps(employees);
const address = (provinceCode: string | null, province: string | null = null) => ({ provinceCode, province, countryCodeV2: "CA" });
const record = (overrides: Partial<DashboardSalesRecord> = {}): DashboardSalesRecord => ({
  storeId: "store1", createdAt: "2026-09-10T12:00:00Z", tags: [], shippingAddress: address("ON"), billingAddress: null, ...overrides,
});
const owner = (overrides: Partial<DashboardSalesRecord>) => resolveDashboardSalesAttribution(record(overrides), reps);

describe("dashboard sales ownership", () => {
  it.each([[], ["Aaron"], ["Aron"], ["Craig"]].map((tags) => ({ tags })))("assigns RF BC orders to Aaron regardless of tags $tags", ({ tags }) => {
    expect(owner({ tags, shippingAddress: address("BC") })).toEqual({ status: "unique", employeeId: "sales-agent-aaron" });
  });

  it.each([" Rob ", "#ROB", "Rob Glas", "Rob Glass", "Robert Glas", "Robert Glass"])("keeps BC orders tagged %s with Rob instead of Aaron", (tag) => {
    expect(owner({ tags: [tag], shippingAddress: address("BC") })).toEqual({ status: "unique", employeeId: "rob" });
    expect(owner({ tags: [tag, "Aaron", "Craig"], shippingAddress: address("BC") })).toEqual({ status: "unique", employeeId: "rob" });
  });

  it("enforces Aaron's fixed July 16 start date", () => {
    expect(owner({ tags: ["Aaron"], shippingAddress: address("BC"), createdAt: "2026-07-16T03:59:59Z" })).toEqual({ status: "unassigned" });
    expect(owner({ tags: ["Rob"], shippingAddress: address("BC"), createdAt: "2026-07-16T03:59:59Z" })).toEqual({ status: "unique", employeeId: "rob" });
    expect(owner({ shippingAddress: address("BC"), createdAt: "2026-07-16T04:00:00Z" })).toEqual({ status: "unique", employeeId: "sales-agent-aaron" });
    expect(owner({ shippingAddress: address("BC"), createdAt: undefined })).toEqual({ status: "unassigned" });
  });

  it("requires the RF store and BC destination for Aaron", () => {
    expect(owner({ tags: ["Aaron"] })).toEqual({ status: "unassigned" });
    expect(owner({ storeId: "store3", tags: ["Aaron"], shippingAddress: address("BC") })).toEqual({ status: "unassigned" });
    expect(owner({ storeId: "store2", tags: ["Aron"], shippingAddress: address("BC") })).toEqual({ status: "unassigned" });
    expect(owner({ tags: ["Aron"], shippingAddress: { ...address("BC"), countryCodeV2: "US" } })).toEqual({ status: "unassigned" });
    expect(owner({ shippingAddress: address(null, "British Columbia") })).toEqual({ status: "unique", employeeId: "sales-agent-aaron" });
    expect(owner({ shippingAddress: null, billingAddress: address("BC") })).toEqual({ status: "unique", employeeId: "sales-agent-aaron" });
    expect(owner({ tags: ["Aaron"], billingAddress: address("BC") })).toEqual({ status: "unassigned" });
  });

  it("links Aaron to an existing sales employee when present", () => {
    const linked = dashboardSalesReps([...employees, { id: "aaron-profile", name: "Aaron Smith", department: "sales", shopify_tags: [] }]);
    expect(linked.at(-1)).toMatchObject({ id: "aaron-profile", name: "Aaron Smith", hasEmployeeProfile: true, storeId: "store1" });
    expect(resolveDashboardSalesAttribution(record({ tags: ["aron"], shippingAddress: address("BC") }), linked)).toEqual({ status: "unique", employeeId: "aaron-profile" });
  });

  it("includes current reps and Aaron even without an employee profile", () => {
    expect(reps.map((rep) => rep.id)).toEqual(["rob", "daniel", "craig", "marie", "sales-agent-aaron"]);
  });

  it.each(["Marijac", "MARIJAC", " marijac "])("assigns BC Transparent records tagged %s to Marie", (tag) => {
    expect(owner({ storeId: "store3", tags: [tag] })).toEqual({ status: "unique", employeeId: "marie" });
  });

  it("uses Marie's confirmed exact tag without matching names or partial tags", () => {
    for (const tag of ["Marie", "Marie Gauthier", "Marijac follow-up"]) {
      expect(owner({ storeId: "store3", tags: [tag] })).toEqual({ status: "unassigned" });
    }
    expect(reps.find((rep) => rep.id === "marie")).toMatchObject({ tags: ["marijac"], placeholder: false });
  });

  it.each([" Rob ", "#ROB", "Rob Glas", "Rob Glass", "Robert Glas", "Robert Glass"])("recognizes Rob's exact alias %s", (tag) => {
    expect(owner({ tags: [tag] })).toEqual({ status: "unique", employeeId: "rob" });
  });

  it("recognizes Craig and rejects substring matches", () => {
    expect(owner({ tags: ["CRAIG"] })).toEqual({ status: "unique", employeeId: "craig" });
    expect(owner({ tags: ["Robertson", "Craig follow-up"] })).toEqual({ status: "unassigned" });
  });

  it.each(["QC", "NS", "NB", "PE"])("assigns untagged and Rob-tagged RF orders in %s to Daniel", (province) => {
    for (const tags of [[], ["rob"], ["craig"], ["rob", "craig"]]) {
      expect(owner({ shippingAddress: address(province), tags })).toEqual({ status: "unique", employeeId: "daniel" });
    }
  });

  it("uses normalized province names and billing only when shipping is absent", () => {
    expect(owner({ shippingAddress: address(null, "Québec") })).toEqual({ status: "unique", employeeId: "daniel" });
    expect(owner({ shippingAddress: null, billingAddress: address("NB") })).toEqual({ status: "unique", employeeId: "daniel" });
    expect(owner({ billingAddress: address("QC") })).toEqual({ status: "unassigned" });
    expect(owner({ shippingAddress: null, billingAddress: null, tags: ["daniel"] })).toEqual({ status: "unassigned" });
  });

  it("keeps Daniel's territory to Quebec and the three Maritime provinces", () => {
    expect(owner({ tags: ["daniel"] })).toEqual({ status: "unassigned" });
    expect(owner({ shippingAddress: address("NL") })).toEqual({ status: "unassigned" });
    expect(owner({ shippingAddress: { ...address("QC"), countryCodeV2: "US" } })).toEqual({ status: "unassigned" });
  });

  it("enforces the RF and BC store boundaries", () => {
    expect(owner({ storeId: "store3", tags: ["Marijac"], shippingAddress: address("QC") })).toEqual({ status: "unique", employeeId: "marie" });
    expect(owner({ tags: ["Marijac"] })).toEqual({ status: "unassigned" });
    expect(owner({ storeId: "store3", tags: ["rob", "craig"] })).toEqual({ status: "unassigned" });
    expect(owner({ storeId: "store2", tags: ["rob", "craig", "Marijac"], shippingAddress: address("QC") })).toEqual({ status: "unassigned" });
  });

  it("counts multiple aliases once and flags conflicting rep tags outside Daniel's territory", () => {
    expect(owner({ tags: ["rob", "Robert Glas"] })).toEqual({ status: "unique", employeeId: "rob" });
    expect(owner({ tags: ["rob", "Craig"] })).toEqual({ status: "ambiguous" });
  });
});

const money = (amount: number) => ({ shopMoney: { amount: String(amount) } });
const transaction = (kind: string, amount: number, processedAt = "2026-09-10T12:00:00Z", status = "SUCCESS") => ({
  kind, status, processedAt, amountSet: money(amount),
});
const order = (transactions: DashboardSalesOrder["transactions"]): DashboardSalesOrder => ({
  ...record(), currentTotalPriceSet: money(1243), currentTotalTaxSet: money(143), currentShippingPriceSet: money(100),
  totalPriceSet: money(1243), totalTaxSet: money(143), totalShippingPriceSet: money(100), transactions,
});
const start = new Date("2026-09-01T04:00:00Z");
const end = new Date("2026-10-01T04:00:00Z");

describe("dashboard net sales from Rob's payment report", () => {
  it("deducts tax and shipping from collected money and ignores authorization holds", () => {
    expect(salesInPeriod(order([
      transaction("AUTHORIZATION", 1243), transaction("CAPTURE", 1243),
      transaction("SALE", 1243, undefined, "FAILURE"), transaction("VOID", 1243),
    ]), start, end)).toBeCloseTo(1000);
  });

  it("splits installments by payment date, including payments on older orders", () => {
    const installments = order([
      transaction("CAPTURE", 621.5, "2026-08-20T12:00:00Z"),
      transaction("CAPTURE", 621.5),
    ]);
    expect(salesInPeriod(installments, start, end)).toBeCloseTo(500);
  });

  it("retains negative refund-only periods and full refunds", () => {
    expect(salesInPeriod(order([transaction("REFUND", 621.5)]), start, end)).toBeCloseTo(-500);
    const refunded = { ...order([transaction("REFUND", 1243)]), currentTotalPriceSet: money(0), currentTotalTaxSet: money(0), currentShippingPriceSet: money(0) };
    expect(salesInPeriod(refunded, start, end)).toBeCloseTo(-1000);
  });

  it("uses an inclusive start and exclusive end across Toronto midnight", () => {
    expect(salesInPeriod(order([
      transaction("SALE", 1243, "2026-09-01T03:59:59Z"),
      transaction("SALE", 1243, start.toISOString()),
      transaction("SALE", 1243, end.toISOString()),
    ]), start, end)).toBeCloseTo(1000);
  });

  it("does not turn unpaid orders into sales", () => {
    expect(salesInPeriod(order([]), start, end)).toBe(0);
    expect(salesInPeriod(order([transaction("SALE", 1243, undefined, "PENDING")]), start, end)).toBe(0);
  });
});
