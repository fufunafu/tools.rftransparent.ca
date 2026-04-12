import { describe, it, expect } from "vitest";
import {
  sanitizePhone,
  pctChange,
  computeMetrics,
  deduplicateRecords,
  CallRecord,
} from "./call-metrics";

// --- Helper to build test call records ---
let _id = 0;
function call(overrides: Partial<CallRecord> & { call_start: string; direction: string }): CallRecord {
  return {
    id: String(++_id),
    call_end: null,
    from_number: "5145551234",
    to_number: "4165559999",
    duration_min: 3,
    charge: 0,
    endpoint: null,
    source: "cik",
    ...overrides,
  };
}

// Monday 9am ET = 2026-03-02T14:00:00Z
const MON_9AM = "2026-03-02T14:00:00+00:00";
const MON_930AM = "2026-03-02T14:30:00+00:00";
const MON_10AM = "2026-03-02T15:00:00+00:00";
const MON_2PM = "2026-03-02T19:00:00+00:00";
// 3 days later (Thursday)
const THU_9AM = "2026-03-05T14:00:00+00:00";
// Saturday
const SAT_9AM = "2026-03-07T14:00:00+00:00";

// ─────────────────────────────────────────────
// sanitizePhone
// ─────────────────────────────────────────────
describe("sanitizePhone", () => {
  it("strips non-digit characters", () => {
    expect(sanitizePhone("(514) 555-1234")).toBe("5145551234");
  });

  it("strips leading country code 1 from 11-digit numbers", () => {
    expect(sanitizePhone("14165551234")).toBe("4165551234");
  });

  it("keeps 10-digit numbers as-is", () => {
    expect(sanitizePhone("4165551234")).toBe("4165551234");
  });

  it("returns null for empty/null input", () => {
    expect(sanitizePhone(null)).toBeNull();
    expect(sanitizePhone("")).toBeNull();
  });

  it("returns null for too-short numbers", () => {
    expect(sanitizePhone("12")).toBeNull();
  });

  it("does not strip leading 1 from 10-digit numbers", () => {
    expect(sanitizePhone("1234567890")).toBe("1234567890");
  });
});

// ─────────────────────────────────────────────
// pctChange
// ─────────────────────────────────────────────
describe("pctChange", () => {
  it("returns percentage change", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });

  it("returns null when previous is zero", () => {
    expect(pctChange(10, 0)).toBeNull();
  });
});

// ─────────────────────────────────────────────
// computeMetrics — basic counts
// ─────────────────────────────────────────────
describe("computeMetrics", () => {
  it("counts total, inbound, outbound correctly", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", endpoint: "206" }),
      call({ call_start: MON_930AM, direction: "inbound", endpoint: null }),
      call({ call_start: MON_10AM, direction: "outbound", endpoint: "208" }),
    ];
    const m = computeMetrics(records);
    expect(m.total_calls).toBe(3);
    expect(m.inbound_calls).toBe(2);
    expect(m.outbound_calls).toBe(1);
  });

  it("counts voicemails as missed/unanswered", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", endpoint: "VM_rftransparent_206" }),
      call({ call_start: MON_930AM, direction: "inbound", endpoint: "vm" }),
      call({ call_start: MON_10AM, direction: "inbound", endpoint: "206" }),
      call({ call_start: MON_2PM, direction: "inbound", endpoint: null }),
    ];
    const m = computeMetrics(records);
    expect(m.vm_calls).toBe(2);
    // missed = no endpoint (1) + voicemail (2) = 3
    expect(m.missed_calls).toBe(3);
  });

  it("treats CIK extension numbers as answered", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", endpoint: "206" }),
      call({ call_start: MON_930AM, direction: "inbound", endpoint: "101" }),
    ];
    const m = computeMetrics(records);
    expect(m.missed_calls).toBe(0);
  });
});

// ─────────────────────────────────────────────
// computeMetrics — miss rate excludes weekends
// ─────────────────────────────────────────────
describe("computeMetrics — miss rate", () => {
  it("excludes weekend calls from miss rate", () => {
    const records = [
      // 2 weekday inbound: 1 missed, 1 answered
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null }),
      call({ call_start: MON_10AM, direction: "inbound", endpoint: "206" }),
      // 1 Saturday inbound: missed (should NOT affect miss rate)
      call({ call_start: SAT_9AM, direction: "inbound", endpoint: null }),
    ];
    const m = computeMetrics(records);
    // Miss rate = 1 weekday missed / 2 weekday inbound = 50%
    expect(m.miss_rate).toBe(50);
  });
});

// ─────────────────────────────────────────────
// computeMetrics — recovery & callbacks
// ─────────────────────────────────────────────
describe("computeMetrics — recovery", () => {
  it("counts outbound callback as recovery", () => {
    const records = [
      // Missed inbound from customer
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551234" }),
      // Staff calls customer back 30 min later
      call({ call_start: MON_930AM, direction: "outbound", to_number: "5145551234" }),
    ];
    const m = computeMetrics(records);
    // missed_calls = total initially unanswered (1), recovery is tracked separately
    expect(m.missed_calls).toBe(1);
    expect(m.recovery_rate).toBe(100);
    expect(m.avg_response_time).toBe(30); // 30 minutes
  });

  it("counts customer calling back and getting answered as recovery", () => {
    const records = [
      // Missed inbound
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551234" }),
      // Customer calls again 1 hour later, gets answered
      call({ call_start: MON_10AM, direction: "inbound", endpoint: "206", from_number: "5145551234" }),
    ];
    const m = computeMetrics(records);
    expect(m.recovery_rate).toBe(100);
    // avg_response_time is null because no OUTBOUND callback was made
    expect(m.avg_response_time).toBeNull();
  });

  it("does NOT count customer leaving another voicemail as recovery", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551234" }),
      // Customer calls again but gets voicemail again
      call({ call_start: MON_10AM, direction: "inbound", endpoint: "vm", from_number: "5145551234" }),
    ];
    const m = computeMetrics(records);
    // Both calls are unanswered (1 null + 1 vm = 2 missed)
    // The second VM does not resolve the first
    expect(m.missed_calls).toBe(2);
    expect(m.recovery_rate).toBe(0);
  });

  it("ignores callbacks more than 48 hours later", () => {
    const records = [
      // Monday 9am missed call
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551234" }),
      // Thursday 9am callback (72 hours later — outside 48h window)
      call({ call_start: THU_9AM, direction: "outbound", to_number: "5145551234" }),
    ];
    const m = computeMetrics(records);
    expect(m.recovery_rate).toBe(0);
    expect(m.missed_calls).toBe(1); // not recovered
  });

  it("counts callback within 48h window", () => {
    // Tuesday 9am = 24 hours after Monday 9am
    const TUE_9AM = "2026-03-03T14:00:00+00:00";
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551234" }),
      call({ call_start: TUE_9AM, direction: "outbound", to_number: "5145551234" }),
    ];
    const m = computeMetrics(records);
    expect(m.recovery_rate).toBe(100);
    expect(m.avg_response_time).toBe(60 * 24); // 24 hours in minutes
  });
});

// ─────────────────────────────────────────────
// computeMetrics — phone number normalization
// ─────────────────────────────────────────────
describe("computeMetrics — phone normalization", () => {
  it("matches callback when CIK has country code and GH does not", () => {
    const records = [
      // GH missed call from "5145551234" (no country code)
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551234", source: "grasshopper" }),
      // CIK outbound callback to "15145551234" (with country code)
      call({ call_start: MON_930AM, direction: "outbound", to_number: "15145551234", source: "cik" }),
    ];
    const m = computeMetrics(records);
    // sanitizePhone("15145551234") = "5145551234" — should match
    expect(m.recovery_rate).toBe(100);
    expect(m.avg_response_time).toBe(30);
  });
});

// ─────────────────────────────────────────────
// computeMetrics — duration
// ─────────────────────────────────────────────
describe("computeMetrics — duration", () => {
  it("calculates avg inbound duration excluding VM and zero-duration", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", endpoint: "206", duration_min: 5 }),
      call({ call_start: MON_930AM, direction: "inbound", endpoint: "201", duration_min: 3 }),
      // VM — excluded from avg duration
      call({ call_start: MON_10AM, direction: "inbound", endpoint: "VM_206", duration_min: 1 }),
      // Zero duration — excluded
      call({ call_start: MON_2PM, direction: "inbound", endpoint: "206", duration_min: 0 }),
    ];
    const m = computeMetrics(records);
    // avg of 5 and 3 = 4
    expect(m.avg_duration_inbound).toBe(4);
  });

  it("calculates avg outbound duration excluding zero-duration", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "outbound", endpoint: "208", duration_min: 2 }),
      call({ call_start: MON_930AM, direction: "outbound", endpoint: "208", duration_min: 4 }),
      call({ call_start: MON_10AM, direction: "outbound", endpoint: "208", duration_min: 0 }),
    ];
    const m = computeMetrics(records);
    // avg of 2 and 4 = 3
    expect(m.avg_duration_outbound).toBe(3);
  });
});

// ─────────────────────────────────────────────
// computeMetrics — outbound callback rate
// ─────────────────────────────────────────────
describe("computeMetrics — outbound callback rate", () => {
  it("measures % of missed calls that got an outbound callback", () => {
    const records = [
      // 2 missed calls from different numbers
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145551111" }),
      call({ call_start: MON_9AM, direction: "inbound", endpoint: null, from_number: "5145552222" }),
      // Only 1 got a callback
      call({ call_start: MON_930AM, direction: "outbound", to_number: "5145551111" }),
    ];
    const m = computeMetrics(records);
    expect(m.outbound_callback_rate).toBe(50); // 1 out of 2
  });
});

// ─────────────────────────────────────────────
// deduplicateRecords
// ─────────────────────────────────────────────
describe("deduplicateRecords", () => {
  it("removes CIK inbound duplicate of GH inbound within 120s", () => {
    const records = [
      call({ call_start: "2026-03-02T14:00:00+00:00", direction: "inbound", from_number: "5145551234", source: "grasshopper" }),
      call({ call_start: "2026-03-02T14:00:30+00:00", direction: "inbound", from_number: "5145551234", source: "cik" }),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("grasshopper");
  });

  it("keeps CIK inbound when no matching GH call exists", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", from_number: "5145559999", source: "cik" }),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(1);
  });

  it("keeps CIK inbound when time difference exceeds 120s", () => {
    const records = [
      call({ call_start: "2026-03-02T14:00:00+00:00", direction: "inbound", from_number: "5145551234", source: "grasshopper" }),
      // 3 minutes later — outside 120s window
      call({ call_start: "2026-03-02T14:03:00+00:00", direction: "inbound", from_number: "5145551234", source: "cik" }),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("never removes CIK outbound calls", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", from_number: "5145551234", source: "grasshopper" }),
      call({ call_start: MON_9AM, direction: "outbound", from_number: "5145551234", source: "cik" }),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("never removes GH records", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", from_number: "5145551234", source: "grasshopper" }),
      call({ call_start: MON_9AM, direction: "inbound", from_number: "5145551234", source: "grasshopper" }),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("matches across phone number formats (with/without country code)", () => {
    const records = [
      call({ call_start: MON_9AM, direction: "inbound", from_number: "5145551234", source: "grasshopper" }),
      // Same number with country code prefix
      call({ call_start: MON_9AM, direction: "inbound", from_number: "15145551234", source: "cik" }),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("grasshopper");
  });
});

// ─────────────────────────────────────────────
// Full scenario: realistic day of calls
// ─────────────────────────────────────────────
describe("full scenario — realistic day", () => {
  it("computes correct metrics for a mixed day of calls", () => {
    const records = [
      // 9:00 — Customer A calls, answered at ext 206 (3 min)
      call({ call_start: "2026-03-02T14:00:00+00:00", direction: "inbound", endpoint: "206", from_number: "5141111111", duration_min: 3 }),
      // 9:15 — Customer B calls, no answer
      call({ call_start: "2026-03-02T14:15:00+00:00", direction: "inbound", endpoint: null, from_number: "5142222222", duration_min: 0 }),
      // 9:30 — Customer C calls, goes to voicemail (1 min message)
      call({ call_start: "2026-03-02T14:30:00+00:00", direction: "inbound", endpoint: "VM_rftransparent_206", from_number: "5143333333", duration_min: 1 }),
      // 10:00 — Staff calls Customer B back (5 min)
      call({ call_start: "2026-03-02T15:00:00+00:00", direction: "outbound", to_number: "5142222222", duration_min: 5 }),
      // 10:30 — Staff calls Customer C back (2 min)
      call({ call_start: "2026-03-02T15:30:00+00:00", direction: "outbound", to_number: "5143333333", duration_min: 2 }),
      // 11:00 — Customer D calls, answered at ext 201 (7 min)
      call({ call_start: "2026-03-02T16:00:00+00:00", direction: "inbound", endpoint: "201", from_number: "5144444444", duration_min: 7 }),
      // 14:00 — Customer E calls, no answer, no callback
      call({ call_start: "2026-03-02T19:00:00+00:00", direction: "inbound", endpoint: null, from_number: "5145555555", duration_min: 0 }),
    ];

    const m = computeMetrics(records);

    // Counts
    expect(m.total_calls).toBe(7);
    expect(m.inbound_calls).toBe(5);
    expect(m.outbound_calls).toBe(2);
    expect(m.vm_calls).toBe(1);

    // Missed = no endpoint (2: B, E) + voicemail (1: C) = 3 unanswered
    expect(m.missed_calls).toBe(3);

    // Recovery: B recovered (outbound callback), C recovered (outbound callback), E not recovered
    // recovered = 2 out of 3
    expect(m.recovery_rate).toBe(66.7);

    // Response time: B waited 45min, C waited 60min -> avg = 52.5 -> rounds to 53
    expect(m.avg_response_time).toBe(53);

    // Outbound callback rate: 2 callbacks out of 3 unanswered = 66.7%
    expect(m.outbound_callback_rate).toBe(66.7);

    // Miss rate (weekday): 3 unanswered / 5 inbound = 60%
    expect(m.miss_rate).toBe(60);

    // Avg inbound duration: answered calls with duration > 0 = A(3) + D(7) = avg 5
    expect(m.avg_duration_inbound).toBe(5);

    // Avg outbound duration: 5 + 2 = avg 3.5
    expect(m.avg_duration_outbound).toBe(3.5);
  });
});
