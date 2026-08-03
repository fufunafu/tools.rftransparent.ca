import { describe, expect, it } from "vitest";
import {
  matchPhoneCallsToLeads,
  type PhoneCallForLeadSync,
} from "@/lib/lead-call-sync";

function lead(
  id: string,
  phone: string | null,
  submittedAt = "2026-08-01T12:00:00.000Z",
) {
  return {
    id,
    phone,
    submitted_at: submittedAt,
    call_status: "not_called" as const,
    outcome: "new" as const,
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

  it("ignores malformed short phone numbers", () => {
    expect(matchPhoneCallsToLeads([lead("lead-1", "555")], [call({ to_number: "555" })])).toEqual([]);
  });
});
