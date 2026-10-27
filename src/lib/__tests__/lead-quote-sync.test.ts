import { beforeEach, describe, expect, it } from "vitest";
import {
  matchDraftOrdersToLeads,
  matchStaffToLinkedLeads,
  resetLiveRematchThrottle,
  shouldRematchAfterLiveSync,
  type DraftForLeadQuoteSync,
  type LeadForQuoteSync,
} from "@/lib/lead-quote-sync";

function lead(
  id: string,
  overrides: Partial<LeadForQuoteSync> = {},
): LeadForQuoteSync {
  return {
    id,
    email: "jane@example.com",
    phone: "+1 (514) 555-1234",
    submitted_at: "2026-08-01T12:00:00.000Z",
    outcome: "contacted",
    quote_number: null,
    assigned_to: null,
    not_applicable_reason: null,
    ...overrides,
  };
}

function draft(
  id: string,
  overrides: Partial<DraftForLeadQuoteSync> = {},
): DraftForLeadQuoteSync {
  return {
    shopify_draft_id: id,
    draft_name: `#${id}`,
    customer_email: "jane@example.com",
    customer_phone: "5145551234",
    quote_amount: "1250.50",
    shopify_created_at: "2026-08-01T13:00:00.000Z",
    shopify_status: "INVOICE_SENT",
    last_invoice_sent_at: overrides.shopify_created_at ?? "2026-08-01T13:00:00.000Z",
    first_synced_at: "2026-08-01T13:05:00.000Z",
    last_invoice_sender: "Anne Seller",
    created_by_staff: "Chris Creator",
    ...overrides,
  };
}

describe("matchDraftOrdersToLeads", () => {
  it("matches normalized emails and links an invoiced draft as quoted", () => {
    const matches = matchDraftOrdersToLeads(
      [lead("lead-1", { email: " Jane@Example.com " })],
      [draft("D100")],
    );

    expect(matches).toEqual([
      {
        leadId: "lead-1",
        draftId: "D100",
        quoteNumber: "#D100",
        quoteAmount: 1250.5,
        quoteSentAt: "2026-08-01T13:00:00.000Z",
        firstQuoteAt: "2026-08-01T13:00:00.000Z",
        outcome: "quoted",
        responsibleStaff: "Anne Seller",
      },
    ]);
  });

  it("does not override conflicting emails with a shared phone", () => {
    const matches = matchDraftOrdersToLeads(
      [lead("lead-1", { email: "other@example.com" })],
      [draft("D100", { customer_email: "unknown@example.com", customer_phone: "+1 514 555 1234" })],
    );

    expect(matches.map((match) => match.leadId)).toEqual([]);
  });

  it("prefers an email match when email and phone identify different leads", () => {
    const matches = matchDraftOrdersToLeads(
      [
        lead("email-match", { phone: "5145559999" }),
        lead("phone-match", { email: "other@example.com", submitted_at: "2026-08-01T12:30:00.000Z" }),
      ],
      [draft("D100")],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["email-match"]);
  });

  it("ignores drafts created before the matching lead was submitted", () => {
    const matches = matchDraftOrdersToLeads(
      [lead("lead-1", { submitted_at: "2026-08-01T14:00:00.000Z" })],
      [draft("D100")],
    );

    expect(matches).toEqual([]);
  });

  it("matches repeated contacts to the newest lead that existed when each draft was created", () => {
    const matches = matchDraftOrdersToLeads(
      [
        lead("older", { submitted_at: "2026-07-01T12:00:00.000Z" }),
        lead("newer", { submitted_at: "2026-08-01T12:00:00.000Z" }),
      ],
      [
        draft("D-JULY", { shopify_created_at: "2026-07-02T12:00:00.000Z" }),
        draft("D-AUG", { shopify_created_at: "2026-08-02T12:00:00.000Z" }),
      ],
    );

    expect(matches.map((match) => [match.leadId, match.draftId])).toEqual([
      ["older", "D-JULY"],
      ["newer", "D-AUG"],
    ]);
  });

  it("does not fall back to an older lead when the newest contact is protected", () => {
    const protectedOutcomes: LeadForQuoteSync[] = [
      lead("older", { submitted_at: "2026-07-01T12:00:00.000Z" }),
      lead("newer", { quote_number: "#MANUAL", submitted_at: "2026-08-01T12:00:00.000Z" }),
    ];

    expect(matchDraftOrdersToLeads(protectedOutcomes, [draft("D100")])).toEqual([]);
    expect(
      matchDraftOrdersToLeads(
        [
          protectedOutcomes[0],
          lead("newer", { outcome: "lost", submitted_at: "2026-08-01T12:00:00.000Z" }),
        ],
        [draft("D100")],
      ),
    ).toEqual([]);
    expect(
      matchDraftOrdersToLeads(
        [
          protectedOutcomes[0],
          lead("newer", { outcome: "not_applicable", submitted_at: "2026-08-01T12:00:00.000Z" }),
        ],
        [draft("D100")],
      ),
    ).toEqual([]);
  });

  it("ignores a historical duplicate when matching a quote to the active lead", () => {
    const matches = matchDraftOrdersToLeads(
      [
        lead("current", { submitted_at: "2026-08-05T20:54:49.775Z" }),
        lead("historical", {
          submitted_at: "2026-08-05T20:54:52.000Z",
          outcome: "not_applicable",
          not_applicable_reason: "Historical Powerful Form Builder record; workflow status unknown",
        }),
      ],
      [draft("D100", { shopify_created_at: "2026-08-07T15:58:53.000Z" })],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["current"]);
  });

  it("links a historical import when no live lead exists and re-opens it", () => {
    const matches = matchDraftOrdersToLeads(
      [
        lead("historical", {
          outcome: "not_applicable",
          not_applicable_reason: "Historical Powerful Form Builder record; workflow status unknown",
        }),
      ],
      [draft("D100", { shopify_status: "COMPLETED" })],
    );

    expect(matches.map((match) => [match.leadId, match.outcome, match.reopenHistorical]))
      .toEqual([["historical", "won", true]]);
  });

  it("still skips leads closed as not applicable for other reasons", () => {
    expect(matchDraftOrdersToLeads(
      [lead("spam", { outcome: "not_applicable", not_applicable_reason: "Spam" })],
      [draft("D100")],
    )).toEqual([]);
  });

  it("marks a completed draft as won", () => {
    const [match] = matchDraftOrdersToLeads(
      [lead("lead-1")],
      [draft("D100", { shopify_status: "COMPLETED" })],
    );

    expect(match.outcome).toBe("won");
  });

  it("falls back to the draft creator when no invoice sender is available", () => {
    const [match] = matchDraftOrdersToLeads(
      [lead("lead-1")],
      [draft("D100", { last_invoice_sender: null })],
    );

    expect(match.responsibleStaff).toBe("Chris Creator");
  });

  it("links the latest sent draft when one lead has multiple drafts", () => {
    const matches = matchDraftOrdersToLeads(
      [lead("lead-1")],
      [
        draft("D-LATER", { shopify_created_at: "2026-08-03T12:00:00.000Z" }),
        draft("D-FIRST", { shopify_created_at: "2026-08-02T12:00:00.000Z" }),
      ],
    );

    expect(matches.map((match) => match.draftId)).toEqual(["D-LATER"]);
  });

  it("ignores open drafts and deduplicates repeated draft rows", () => {
    const matches = matchDraftOrdersToLeads(
      [lead("lead-1")],
      [
        draft("OPEN", { shopify_status: "OPEN" }),
        draft("D100"),
        draft("D100"),
      ],
    );

    expect(matches.map((match) => match.draftId)).toEqual(["D100"]);
  });
});

describe("matchStaffToLinkedLeads", () => {
  it("backfills the last invoice sender for an already-linked quote", () => {
    const matches = matchStaffToLinkedLeads(
      [lead("lead-1", { quote_number: "#D100" })],
      [draft("D100")],
    );

    expect(matches).toEqual([
      { leadId: "lead-1", responsibleStaff: "Anne Seller" },
    ]);
  });

  it("uses phone as a fallback and never replaces a manual assignment", () => {
    expect(
      matchStaffToLinkedLeads(
        [lead("lead-1", { email: null, quote_number: "#D100" })],
        [draft("D100", { customer_email: "unknown@example.com" })],
      ),
    ).toEqual([{ leadId: "lead-1", responsibleStaff: "Anne Seller" }]);

    expect(
      matchStaffToLinkedLeads(
        [lead("lead-1", { quote_number: "#D100", assigned_to: "Manual Owner" })],
        [draft("D100")],
      ),
    ).toEqual([]);
  });

  it("does not use staff from a same-number draft with a different contact", () => {
    expect(
      matchStaffToLinkedLeads(
        [lead("lead-1", { quote_number: "#D100" })],
        [
          draft("D100", {
            customer_email: "other@example.com",
            customer_phone: "4165559999",
          }),
        ],
      ),
    ).toEqual([]);
  });
});

describe("shouldRematchAfterLiveSync", () => {
  const changed = { new_leads: 0, updated_leads: 1, auto_won: 0 };
  const unchanged = { new_leads: 0, updated_leads: 0, auto_won: 0 };
  const NOW = Date.parse("2026-10-26T16:00:00Z");

  beforeEach(() => resetLiveRematchThrottle());

  it("skips the re-match when the sync touched no drafts", () => {
    expect(shouldRematchAfterLiveSync("store1", unchanged, NOW)).toBe(false);
  });

  it("re-matches after changes at most once per two minutes per store", () => {
    expect(shouldRematchAfterLiveSync("store1", changed, NOW)).toBe(true);
    expect(shouldRematchAfterLiveSync("store1", changed, NOW + 60_000)).toBe(false);
    expect(shouldRematchAfterLiveSync("store2", changed, NOW + 60_000)).toBe(true);
    expect(shouldRematchAfterLiveSync("store1", changed, NOW + 120_000)).toBe(true);
  });

  it("does not start the wait on a tick that skipped for lack of changes", () => {
    expect(shouldRematchAfterLiveSync("store1", unchanged, NOW)).toBe(false);
    expect(shouldRematchAfterLiveSync("store1", changed, NOW + 1_000)).toBe(true);
  });
});

it('updates an already linked quote after revision and conversion without losing the first response date', () => {
  const original = lead('one', { quote_number: '#D100', quote_draft_id: 'D100', first_quote_at: '2026-08-01T13:00:00.000Z', outcome: 'quoted' });
  const [match] = matchDraftOrdersToLeads([original], [draft('D100', { last_invoice_sent_at: '2026-08-03T12:00:00Z', quote_amount: 2200, shopify_status: 'COMPLETED' })]);
  expect(match).toMatchObject({ quoteAmount: 2200, quoteSentAt: '2026-08-03T12:00:00Z', firstQuoteAt: original.first_quote_at, outcome: 'won' });
});
it('matches a draft created before interest but sent after it, using actual send time', () => {
  const [match] = matchDraftOrdersToLeads([lead('one')], [draft('D100', { shopify_created_at: '2026-07-01T12:00:00Z', last_invoice_sent_at: '2026-08-02T12:00:00Z' })]);
  expect(match).toMatchObject({ leadId: 'one', quoteSentAt: '2026-08-02T12:00:00Z' });
});
it('does not invent a send date when only draft creation is known', () => {
  const [match] = matchDraftOrdersToLeads([lead('one')], [draft('D100', { last_invoice_sent_at: null })]);
  expect(match).toMatchObject({ quoteSentAt: null, firstQuoteAt: null });
});
it('keeps quotes in the matching RF or BC store', () => {
  expect(matchDraftOrdersToLeads([lead('one', { store_id: 'rf_transparent' })], [draft('D100', { store_id: 'store3' })])).toEqual([]);
});
it('does not reopen a won lead when a later quote is sent', () => {
  const [match] = matchDraftOrdersToLeads([lead('one', { outcome: 'won' })], [draft('D100')]);
  expect(match.outcome).toBe('won');
});
