import { describe, expect, it } from "vitest";
import { consolidateDuplicateLeads } from "@/lib/lead-deduplication";
import type { Lead } from "@/lib/customer-service/leads";

function lead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    source: "website",
    source_detail: "Contact Us",
    form_id: null,
    page_url: "https://example.com/contact",
    name: "Bev",
    email: "bev'scarpentry@hotmail.com",
    phone: "902-527-8969",
    message: null,
    raw_payload: {},
    submitted_at: "2026-08-03T12:08:04.000Z",
    call_status: "not_called",
    outcome: "new",
    quote_number: null,
    quote_amount: null,
    quote_sent_at: null,
    lost_reason: null,
    notes: null,
    assigned_to: null,
    created_at: "2026-08-03T12:08:04.000Z",
    updated_at: "2026-08-03T12:08:04.000Z",
    ...overrides,
  };
}

describe("consolidateDuplicateLeads", () => {
  it("combines repeated same-day submissions and preserves the strongest workflow data", () => {
    const result = consolidateDuplicateLeads([
      lead("empty-1"),
      lead("empty-2", { submitted_at: "2026-08-03T12:08:04.004Z" }),
      lead("won", {
        email: "bevscarpentry@hotmail.com",
        submitted_at: "2026-08-03T12:28:19.000Z",
        message: "I have 2 45 degree sections",
        call_status: "called",
        outcome: "won",
        quote_number: "#D3032",
        quote_amount: 4208,
        quote_sent_at: "2026-08-03T14:08:11.000Z",
        assigned_to: "Shanaz Rohoman",
        call_attempts_count: 3,
        first_call_at: "2026-08-03T15:06:16.000Z",
        last_call_at: "2026-08-03T15:41:29.000Z",
        last_called_by: "Extension 206",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "won",
      duplicate_count: 3,
      duplicate_ids: ["empty-1", "empty-2", "won"],
      submitted_at: "2026-08-03T12:08:04.000Z",
      email: "bevscarpentry@hotmail.com",
      call_status: "called",
      outcome: "won",
      quote_number: "#D3032",
      assigned_to: "Shanaz Rohoman",
      call_attempts_count: 3,
    });
  });

  it("keeps repeat projects outside the one-day window separate", () => {
    const result = consolidateDuplicateLeads([
      lead("first", { submitted_at: "2026-07-17T12:00:00.000Z" }),
      lead("second", { submitted_at: "2026-07-28T12:00:00.000Z" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.duplicate_count === 1)).toBe(true);
  });

  it("does not combine matching contacts from different forms or sources", () => {
    const result = consolidateDuplicateLeads([
      lead("website"),
      lead("other-form", { source_detail: "Warranty Form" }),
      lead("meta", { source: "meta" }),
    ]);

    expect(result).toHaveLength(3);
  });

  it("keeps separate quote numbers as separate projects", () => {
    const result = consolidateDuplicateLeads([
      lead("quote-1", { outcome: "quoted", quote_number: "#D1" }),
      lead("quote-2", {
        submitted_at: "2026-08-03T13:00:00.000Z",
        outcome: "quoted",
        quote_number: "#D2",
      }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("combines call summaries even when the quote and calls landed on different rows", () => {
    const result = consolidateDuplicateLeads([
      lead("quote", {
        outcome: "quoted",
        quote_number: "#D1",
        quote_amount: 1000,
      }),
      lead("call", {
        submitted_at: "2026-08-03T12:10:00.000Z",
        call_status: "called",
        outcome: "contacted",
        call_attempts_count: 2,
        first_call_at: "2026-08-03T13:00:00.000Z",
        last_call_at: "2026-08-03T13:30:00.000Z",
        last_called_by: "Extension 206",
      }),
    ]);

    expect(result[0]).toMatchObject({
      call_status: "called",
      outcome: "quoted",
      quote_number: "#D1",
      call_attempts_count: 2,
      last_called_by: "Extension 206",
    });
  });
});
