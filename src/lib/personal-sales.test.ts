import { describe, expect, it } from "vitest";
import {
  personalSalesSummary,
  salesStaffAliases,
  salesStaffPostgrestFilter,
  type PersonalSalesLead,
} from "@/lib/personal-sales";

function lead(overrides: Partial<PersonalSalesLead>): PersonalSalesLead {
  return {
    id: "lead",
    customer_name: "Customer",
    draft_name: "D1",
    quote_amount: 100,
    lead_status: "new",
    next_followup_at: null,
    closed_at: null,
    shopify_created_at: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("personal sales view", () => {
  it("prefers configured tags and removes duplicates", () => {
    expect(salesStaffAliases("Anne Gao", [" Anne ", "Anne", "AG"])).toEqual(["Anne", "AG"]);
    expect(salesStaffAliases("Anne Gao", [])).toEqual(["Anne Gao"]);
  });

  it("quotes aliases in PostgREST attribution filters", () => {
    const filter = salesStaffPostgrestFilter(["A, B", "A \"Quote\""]);
    expect(filter).toContain('last_invoice_sender.eq."A, B"');
    expect(filter).toContain('created_by_staff.eq."A \\"Quote\\""');
  });

  it("counts active, due, overdue, and won work", () => {
    const summary = personalSalesSummary([
      lead({ id: "today", next_followup_at: "2026-08-13T15:00:00.000Z" }),
      lead({ id: "late", next_followup_at: "2026-08-12T15:00:00.000Z" }),
      lead({ id: "won", lead_status: "won", closed_at: "2026-08-10T10:00:00.000Z" }),
    ], new Date("2026-08-13T18:00:00.000Z"));
    expect(summary).toEqual({ active: 2, dueToday: 1, overdue: 1, won: 1 });
  });

  it("uses Toronto day boundaries instead of UTC midnight", () => {
    const summary = personalSalesSummary([
      lead({ id: "late-local-evening", next_followup_at: "2026-08-14T02:00:00.000Z" }),
      lead({ id: "next-local-day", next_followup_at: "2026-08-14T04:00:00.000Z" }),
    ], new Date("2026-08-14T02:30:00.000Z"));
    expect(summary).toEqual({ active: 2, dueToday: 1, overdue: 0, won: 0 });
  });
});
