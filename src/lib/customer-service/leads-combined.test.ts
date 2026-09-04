import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/customer-service/leads";
import type { FollowUpLead } from "@/lib/followup";
import { LEAD_SPAM_REASON } from "@/lib/customer-service/lead-spam";
import {
  assignQuotesToLeads,
  buildCombinedRows,
  countTabs,
  summarize,
  type BuildOptions,
} from "@/lib/customer-service/leads-combined";

const NOW = new Date("2026-09-04T15:00:00Z"); // 11:00 in Toronto
const OPTS: BuildOptions = {
  now: NOW,
  todayStart: "2026-09-04T04:00:00.000Z",
  tomorrowStart: "2026-09-05T04:00:00.000Z",
  addressedQuoteIds: new Set(),
  storeId: "rf_transparent",
};

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: "lead-1",
    store_id: "rf_transparent",
    source: "website",
    source_detail: null,
    form_id: null,
    page_url: null,
    name: "Priya Natarajan",
    email: "priya@example.com",
    phone: "306-555-0139",
    message: null,
    installation_requested: null,
    raw_payload: {},
    submitted_at: "2026-09-03T00:38:00Z",
    call_status: "not_called",
    outcome: "new",
    quote_number: null,
    quote_amount: null,
    quote_sent_at: null,
    lost_reason: null,
    not_applicable_reason: null,
    notes: null,
    assigned_to: null,
    created_at: "2026-09-03T00:38:00Z",
    updated_at: "2026-09-03T00:38:00Z",
    ...overrides,
  };
}

function quote(overrides: Partial<FollowUpLead>): FollowUpLead {
  return {
    id: "quote-1",
    store_id: "store1",
    shopify_draft_id: "gid://shopify/DraftOrder/1",
    draft_name: "#D3243",
    customer_name: "Jean-Luc Bergeron",
    customer_email: "jl@example.com",
    customer_phone: "613-555-0114",
    quote_amount: 4591,
    shopify_created_at: "2026-08-31T18:19:00Z",
    shopify_status: "INVOICE_SENT",
    lead_status: "new",
    next_followup_at: "2026-09-04T12:00:00Z",
    followup_count: 0,
    first_synced_at: "2026-08-31T18:30:00Z",
    last_synced_at: "2026-09-04T13:00:00Z",
    closed_at: null,
    close_reason: null,
    notes: null,
    created_at: "2026-08-31T18:30:00Z",
    updated_at: "2026-09-04T13:00:00Z",
    created_by_staff: "Benjamin Dundas",
    customer_orders_count: 0,
    last_invoice_sender: "Benjamin Dundas",
    contributors: null,
    ...overrides,
  };
}

describe("assignQuotesToLeads", () => {
  it("links by quote number when the contact matches", () => {
    const l = lead({ id: "a", email: "jl@example.com", quote_number: "#D3243", submitted_at: "2026-08-30T13:12:00Z" });
    const { byLead, orphans } = assignQuotesToLeads([l], [quote({})]);
    expect(byLead.get("a")?.map((q) => q.id)).toEqual(["quote-1"]);
    expect(orphans).toHaveLength(0);
  });

  it("does not link a quote number that belongs to a different customer", () => {
    const l = lead({ id: "a", email: "someone-else@example.com", phone: "416-555-0000", quote_number: "#D3243" });
    const { byLead, orphans } = assignQuotesToLeads([l], [quote({})]);
    expect(byLead.size).toBe(0);
    expect(orphans).toHaveLength(1);
  });

  it("falls back to email, choosing the latest lead submitted before the quote", () => {
    const older = lead({ id: "old", email: "jl@example.com", submitted_at: "2026-06-01T00:00:00Z" });
    const newer = lead({ id: "new", email: "JL@example.com", submitted_at: "2026-08-30T13:12:00Z" });
    const later = lead({ id: "later", email: "jl@example.com", submitted_at: "2026-10-30T13:12:00Z" });
    const { byLead } = assignQuotesToLeads([older, newer, later], [quote({})]);
    expect(byLead.get("new")).toHaveLength(1);
    expect(byLead.has("old")).toBe(false);
    expect(byLead.has("later")).toBe(false);
  });

  it("falls back to phone and attaches a form filled shortly after the quote", () => {
    const afterQuote = lead({ id: "after", email: null, phone: "(613) 555-0114", submitted_at: "2026-09-02T00:00:00Z" });
    const { byLead } = assignQuotesToLeads([afterQuote], [quote({ customer_email: null })]);
    expect(byLead.get("after")).toHaveLength(1);
  });
});

describe("buildCombinedRows", () => {
  it("puts an uncalled lead in To do with a call action", () => {
    const [row] = buildCombinedRows([lead({})], [], OPTS);
    expect(row.stage).toBe("new");
    expect(row.callState).toBe("not_called");
    expect(row.next).toMatchObject({ kind: "call", urgency: "now" });
    expect(row.tabs).toContain("todo");
    expect(row.tabs).not.toContain("open");
  });

  it("stops asking for a call once an uncalled lead is over 30 days old", () => {
    const [row] = buildCombinedRows([lead({ submitted_at: "2026-06-01T00:00:00Z" })], [], OPTS);
    expect(row.stage).toBe("new");
    expect(row.next).toMatchObject({ kind: "call", urgency: "none", label: "Never called" });
    expect(row.tabs).not.toContain("todo");
    expect(summarize([row], OPTS).needCall.total).toBe(0);
  });

  it("takes the stage and due date from the linked quote", () => {
    const l = lead({ id: "a", email: "jl@example.com", call_status: "called", outcome: "quoted", submitted_at: "2026-08-30T13:12:00Z", first_call_at: "2026-08-30T14:20:00Z" });
    const [row] = buildCombinedRows([l], [quote({})], OPTS);
    expect(row.stage).toBe("quoted");
    expect(row.next).toMatchObject({ kind: "followup", urgency: "today" });
    expect(row.tabs).toEqual(expect.arrayContaining(["todo", "open", "all"]));
    expect(row.timeToQuoteMs).toBeGreaterThan(0);
  });

  it("flags an overdue follow-up and counts the days", () => {
    const l = lead({ id: "a", email: "jl@example.com", call_status: "called", outcome: "quoted", submitted_at: "2026-08-22T14:14:00Z" });
    const q = quote({ lead_status: "no_answer", next_followup_at: "2026-09-02T12:00:00Z", followup_count: 1 });
    const [row] = buildCombinedRows([l], [q], OPTS);
    expect(row.stage).toBe("no_answer");
    expect(row.next.urgency).toBe("overdue");
    expect(row.next.label).toBe("2 days overdue");
    expect(row.attempts).toBe(1);
  });

  it("creates a quote-only row for a quote that matches nobody and groups by email", () => {
    const rows = buildCombinedRows([], [quote({ id: "q1" }), quote({ id: "q2", draft_name: "#D3244", shopify_created_at: "2026-09-01T10:00:00Z" })], OPTS);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("quote");
    expect(rows[0].source).toBe("quote");
    expect(rows[0].quotes).toHaveLength(2);
    expect(rows[0].next.kind).toBe("resolve");
    expect(rows[0].tabs).toContain("dupes");
  });

  it("hides spam from every tab but counts it", () => {
    const spam = lead({ id: "s", outcome: "not_applicable", not_applicable_reason: LEAD_SPAM_REASON });
    const rows = buildCombinedRows([spam, lead({ id: "ok" })], [], OPTS);
    expect(rows.find((row) => row.id === "s")?.tabs).toEqual([]);
    expect(countTabs(rows).all).toBe(1);
    expect(summarize(rows, OPTS).spam).toBe(1);
  });

  it("summarises calls needed, follow-ups due, and conversion", () => {
    const uncalled = lead({ id: "u" });
    const quoted = lead({ id: "q", email: "jl@example.com", call_status: "called", outcome: "quoted", submitted_at: "2026-08-30T13:12:00Z" });
    const wonQuote = quote({ id: "w", draft_name: "#D1", customer_email: "w@example.com", lead_status: "won", closed_at: "2026-08-20T00:00:00Z", next_followup_at: null });
    const lostQuote = quote({ id: "l", draft_name: "#D2", customer_email: "l@example.com", lead_status: "lost", closed_at: "2026-08-21T00:00:00Z", next_followup_at: null });
    const rows = buildCombinedRows([uncalled, quoted], [quote({}), wonQuote, lostQuote], OPTS);
    const summary = summarize(rows, OPTS);
    expect(summary.needCall.total).toBe(1);
    expect(summary.followupsDue.total).toBe(1);
    expect(summary.openQuotes).toMatchObject({ count: 1, amount: 4591 });
    expect(summary.conversion).toMatchObject({ won: 1, lost: 1, rate: 0.5 });
    expect(summary.newLeads30d.total).toBe(2);
  });
});
