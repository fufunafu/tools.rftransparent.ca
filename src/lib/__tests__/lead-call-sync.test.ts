import { describe, expect, it } from "vitest";
import {
  matchPhoneCallsToLeads,
  recoverLeadPhonesFromLinkedQuotes,
  type PhoneCallForLeadSync,
} from "@/lib/lead-call-sync";

function lead(
  id: string,
  phone: string | null,
  submittedAt = "2026-08-01T12:00:00.000Z",
) {
  return {
    id,
    email: "jane@example.com",
    phone,
    quote_number: null,
    submitted_at: submittedAt,
    call_status: "not_called" as const,
    outcome: "new" as const,
    not_applicable_reason: null,
  };
}

function call(overrides: Partial<PhoneCallForLeadSync> = {}): PhoneCallForLeadSync {
  return {
    id: "680922bf-c520-4126-a5e5-43116c042c47",
    store_id: "rf_transparent",
    call_start: "2026-08-01T13:00:00.000Z",
    call_end: "2026-08-01T13:04:00.000Z",
    from_number: "5145550000",
    to_number: "15145551234",
    direction: "outbound",
    duration_min: 4,
    charge: 0,
    endpoint: "206",
    source: "cik",
    ...overrides,
  };
}

describe("matchPhoneCallsToLeads", () => {
  it("matches normalized outbound numbers and records an answered call", () => {
    const matches = matchPhoneCallsToLeads(
      [lead("lead-1", "+1 (514) 555-1234")],
      [call()],
    );

    expect(matches).toEqual([
      {
        leadId: "lead-1",
        status: "called",
        attempts: [
          expect.objectContaining({
            lead_id: "lead-1",
            staff: "Extension 206",
            result: "Outbound call answered",
          }),
        ],
      },
    ]);
  });

  it("classifies a zero-duration outbound attempt as no answer", () => {
    const [match] = matchPhoneCallsToLeads(
      [lead("lead-1", "5145551234")],
      [call({ duration_min: 0 })],
    );

    expect(match.status).toBe("no_answer");
    expect(match.attempts[0].result).toBe("No answer");
  });

  it("counts an answered inbound call but ignores voicemail and missed inbound calls", () => {
    const matches = matchPhoneCallsToLeads(
      [lead("lead-1", "5145551234")],
      [
        call({ id: "missed", direction: "inbound", from_number: "5145551234", endpoint: null }),
        call({ id: "vm", direction: "inbound", from_number: "5145551234", endpoint: "vm" }),
        call({ id: "answered", direction: "inbound", from_number: "5145551234", endpoint: "208" }),
      ],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe("called");
    expect(matches[0].attempts).toHaveLength(1);
    expect(matches[0].attempts[0].id).toBe("answered");
  });

  it("ignores calls before the lead was submitted", () => {
    expect(
      matchPhoneCallsToLeads(
        [lead("lead-1", "5145551234")],
        [call({ call_start: "2026-08-01T11:59:59.000Z" })],
      ),
    ).toEqual([]);
  });

  it("assigns a call to the most recent eligible lead for a repeated phone number", () => {
    const matches = matchPhoneCallsToLeads(
      [
        lead("older", "5145551234", "2026-07-01T12:00:00.000Z"),
        lead("newer", "5145551234", "2026-08-01T12:00:00.000Z"),
      ],
      [call()],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["newer"]);
  });

  it("does not assign a call when eligible leads sharing the phone have different emails", () => {
    const matches = matchPhoneCallsToLeads(
      [
        {
          ...lead("family-1", "5145551234", "2026-07-01T12:00:00.000Z"),
          email: "alex@example.com",
        },
        {
          ...lead("family-2", "5145551234", "2026-08-01T12:00:00.000Z"),
          email: "sam@example.com",
        },
      ],
      [call()],
    );

    expect(matches).toEqual([]);
  });

  it("still assigns a call made before a second email identity used the phone", () => {
    const matches = matchPhoneCallsToLeads(
      [
        {
          ...lead("first", "5145551234", "2026-07-01T12:00:00.000Z"),
          email: "alex@example.com",
        },
        {
          ...lead("later", "5145551234", "2026-08-02T12:00:00.000Z"),
          email: "sam@example.com",
        },
      ],
      [call()],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["first"]);
  });

  it("treats normalized versions of the same email as one identity", () => {
    const matches = matchPhoneCallsToLeads(
      [
        {
          ...lead("older", "5145551234", "2026-07-01T12:00:00.000Z"),
          email: "JANE@example.com",
        },
        {
          ...lead("newer", "5145551234", "2026-08-01T12:00:00.000Z"),
          email: " jane@example.com ",
        },
      ],
      [call()],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["newer"]);
  });

  it("treats an apostrophe-typo variant of the same email as one identity", () => {
    // Real case: "bev'scarpentry@…" and "bevscarpentry@…" are one person whose
    // calls were all skipped as ambiguous until quote characters were ignored.
    const matches = matchPhoneCallsToLeads(
      [
        {
          ...lead("older", "5145551234", "2026-07-01T12:00:00.000Z"),
          email: "bev'scarpentry@hotmail.com",
        },
        {
          ...lead("newer", "5145551234", "2026-08-01T12:00:00.000Z"),
          email: "bevscarpentry@hotmail.com",
        },
      ],
      [call()],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["newer"]);
  });

  it("prefers the active lead over a newer historical duplicate", () => {
    const matches = matchPhoneCallsToLeads(
      [
        lead("current", "5145551234", "2026-08-05T20:54:49.775Z"),
        {
          ...lead("historical", "5145551234", "2026-08-05T20:54:52.000Z"),
          outcome: "not_applicable",
          not_applicable_reason: "Historical Powerful Form Builder record; workflow status unknown",
        },
      ],
      [call({ call_start: "2026-08-07T15:58:53.000Z" })],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["current"]);
  });

  it("still matches a historical lead when no active lead existed yet", () => {
    const matches = matchPhoneCallsToLeads(
      [{
        ...lead("historical", "5145551234", "2026-08-01T12:00:00.000Z"),
        outcome: "not_applicable",
        not_applicable_reason: "Historical Powerful Form Builder record; workflow status unknown",
      }],
      [call()],
    );

    expect(matches.map((match) => match.leadId)).toEqual(["historical"]);
  });

  it("ignores malformed short phone numbers", () => {
    expect(matchPhoneCallsToLeads([lead("lead-1", "555")], [call({ to_number: "555" })])).toEqual([]);
  });
});

describe("recoverLeadPhonesFromLinkedQuotes", () => {
  it("recovers April's missing form phone from her linked quote", () => {
    const [recovered] = recoverLeadPhonesFromLinkedQuotes(
      [{
        ...lead("april", null, "2026-08-03T22:03:53.000Z"),
        email: "april@myfsdesign.com",
        quote_number: "#D3042",
      }],
      [{
        draft_name: "#D3042",
        customer_email: "april@myfsdesign.com",
        customer_phone: "+18287688673",
      }],
    );

    expect(recovered.phone).toBe("+18287688673");
  });

  it("requires matching email when a quote number is reused", () => {
    const [recovered] = recoverLeadPhonesFromLinkedQuotes(
      [{
        ...lead("april", null),
        email: "april@myfsdesign.com",
        quote_number: "#D3042",
      }],
      [
        {
          draft_name: "#D3042",
          customer_email: "someone@example.com",
          customer_phone: "+15145559999",
        },
        {
          draft_name: "#D3042",
          customer_email: " APRIL@MYFSDESIGN.COM ",
          customer_phone: "+18287688673",
        },
      ],
    );

    expect(recovered.phone).toBe("+18287688673");
  });

  it("keeps an existing valid lead phone", () => {
    const [recovered] = recoverLeadPhonesFromLinkedQuotes(
      [{ ...lead("lead-1", "5145551234"), quote_number: "#D100" }],
      [{
        draft_name: "#D100",
        customer_email: "jane@example.com",
        customer_phone: "4165559999",
      }],
    );

    expect(recovered.phone).toBe("5145551234");
  });
});
