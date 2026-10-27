import { describe, expect, it } from "vitest";
import { businessDayCallMetrics, callDeadlineStatus, leadCallDeadline } from "../lead-business-day";
type CallLead = Parameters<typeof callDeadlineStatus>[0];
const lead = (submitted_at: string, first_call_at: string | null = null): CallLead => ({ submitted_at, first_call_at, phone: "4165550123", call_status: "not_called", outcome: "new", not_applicable_reason: null, raw_payload: {} });
const deadline = (submitted: string) => new Date(leadCallDeadline(submitted)!).toISOString();
describe("business-day call deadline", () => {
  it("uses the same weekday before 5pm and the next weekday at 5pm", () => {
    expect(deadline("2026-10-27T20:59:59Z")).toBe("2026-10-27T21:00:00.000Z");
    expect(deadline("2026-10-27T21:00:00Z")).toBe("2026-10-28T21:00:00.000Z");
  });
  it("moves Friday evening and weekend requests to Monday", () => {
    for (const received of ["2026-10-23T22:00:00Z", "2026-10-24T14:00:00Z", "2026-10-25T22:00:00Z"]) expect(deadline(received)).toBe("2026-10-26T21:00:00.000Z");
  });
  it("uses the deadline-day timezone offset across both DST changes", () => {
    expect(deadline("2026-03-06T23:00:00Z")).toBe("2026-03-09T21:00:00.000Z");
    expect(deadline("2026-10-30T22:00:00Z")).toBe("2026-11-02T22:00:00.000Z");
  });
  it("accepts calls before the assigned deadline, including early weekend calls", () => {
    const now = Date.parse("2026-10-27T22:00:00Z");
    expect(callDeadlineStatus(lead("2026-10-23T22:00:00Z", "2026-10-26T20:00:00Z"), now)).toBe("onTime");
    expect(callDeadlineStatus(lead("2026-10-23T22:00:00Z", "2026-10-24T14:00:00Z"), now)).toBe("onTime");
    expect(callDeadlineStatus(lead("2026-10-23T22:00:00Z", "2026-10-26T21:00:01Z"), now)).toBe("late");
  });
  it("does not penalize leads still inside their deadline or invent timing for undated calls", () => {
    const now = Date.parse("2026-10-26T16:00:00Z");
    const current = lead("2026-10-23T22:00:00Z");
    const unknown = { ...lead("2026-10-22T12:00:00Z"), call_status: "called" as const };
    const result = businessDayCallMetrics([current, unknown, lead("2026-10-22T12:00:00Z"), lead("2026-10-22T12:00:00Z", "2026-10-22T16:00:00Z")], now);
    expect(result).toMatchObject({ pending: 1, unknown: 1, overdue: 1, onTime: 1, due: 2, dueOnTime: 1, sameDayCallRate: 50 });
    expect(businessDayCallMetrics([current], now).sameDayCallRate).toBeNull();
  });
  it("excludes uncallable and inapplicable records, and treats invalid first-call timestamps as unknown", () => {
    const now = Date.parse("2026-10-27T22:00:00Z");
    const row = lead("2026-10-23T22:00:00Z");
    expect(callDeadlineStatus({ ...row, phone: null }, now)).toBe("excluded");
    expect(callDeadlineStatus({ ...row, outcome: "not_applicable", not_applicable_reason: "Spam" }, now)).toBe("excluded");
    expect(callDeadlineStatus({ ...row, first_call_at: "2026-10-22T22:00:00Z" }, now)).toBe("unknown");
  });
});

it("excludes every not-applicable lead from both rate counts, including historical imports", () => {
  const now = Date.parse("2026-10-27T22:00:00Z");
  const eligible = lead("2026-10-22T12:00:00Z", "2026-10-22T16:00:00Z");
  const excluded = [
    { ...lead("2026-10-22T12:00:00Z"), outcome: "not_applicable" as const, raw_payload: { historical_import: {} } },
    { ...eligible, outcome: "not_applicable" as const, raw_payload: { historical_import: {} } },
    { ...lead("2026-10-22T12:00:00Z"), outcome: "not_applicable" as const, not_applicable_reason: null },
  ];
  expect(businessDayCallMetrics([eligible, ...excluded], now)).toMatchObject({ total: 1, due: 1, dueOnTime: 1, sameDayCallRate: 100 });
  expect(businessDayCallMetrics(excluded, now).sameDayCallRate).toBeNull();
});
