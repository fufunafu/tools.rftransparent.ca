/**
 * Pure functions for computing phone call metrics.
 * Extracted from the customer-service API route for testability.
 */

export interface CallRecord {
  id: string;
  call_start: string;
  call_end: string | null;
  from_number: string;
  to_number: string;
  direction: string;
  duration_min: number;
  charge: number;
  endpoint: string | null;
  source: string;
}

export function sanitizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 15) return null;
  // Normalize North American numbers: strip leading country code 1
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

export function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

/** 48-hour callback window in milliseconds */
const CALLBACK_WINDOW_MS = 48 * 60 * 60 * 1000;

export function computeMetrics(records: CallRecord[]) {
  const total = records.length;
  const inbound = records.filter((r) => r.direction === "inbound");
  const outbound = records.filter((r) => r.direction === "outbound");
  const vmCalls = inbound.filter(
    (r) => r.endpoint && r.endpoint.toLowerCase().includes("vm")
  );

  // Index outbound calls by sanitized to_number for callback matching
  const outboundByNumber = new Map<string, string[]>();
  for (const r of outbound) {
    const key = sanitizePhone(r.to_number) ?? r.to_number;
    const times = outboundByNumber.get(key) ?? [];
    times.push(r.call_start);
    outboundByNumber.set(key, times);
  }

  // Track answered inbound calls per number (caller called back and got through)
  // Exclude voicemail — leaving a VM is not a real recovery
  const answeredInboundByNumber = new Map<string, string[]>();
  for (const r of inbound) {
    if (r.endpoint && !r.endpoint.toLowerCase().includes("vm")) {
      const key = sanitizePhone(r.from_number) ?? r.from_number;
      const times = answeredInboundByNumber.get(key) ?? [];
      times.push(r.call_start);
      answeredInboundByNumber.set(key, times);
    }
  }

  // Missed = inbound calls not answered by a person (no endpoint, or voicemail)
  const isVm = (r: CallRecord) => r.endpoint?.toLowerCase().includes("vm");
  const unansweredCalls = inbound.filter((r) => !r.endpoint || isVm(r));

  // For each unanswered call, check if there was a resolution within 48 hours
  const responseTimes: number[] = [];
  let recoveredCount = 0;
  const missedCalls: CallRecord[] = [];

  for (const call of unansweredCalls) {
    const callNumber = sanitizePhone(call.from_number) ?? call.from_number;
    const callTime = new Date(call.call_start).getTime();
    const cutoff = new Date(callTime + CALLBACK_WINDOW_MS).toISOString();
    const outboundCbs = outboundByNumber.get(callNumber);
    const outboundAfter = outboundCbs?.filter((t) => t > call.call_start && t < cutoff).sort() ?? [];
    const answeredCbs = answeredInboundByNumber.get(callNumber);
    const answeredAfter = answeredCbs?.filter((t) => t > call.call_start && t < cutoff).sort() ?? [];

    const hasOutbound = outboundAfter.length > 0;
    const hasAnsweredInbound = answeredAfter.length > 0;
    if (hasOutbound || hasAnsweredInbound) {
      recoveredCount++;
      // Response time only measures outbound callbacks (team effort)
      if (hasOutbound) {
        const diffMin = (new Date(outboundAfter[0]).getTime() - new Date(call.call_start).getTime()) / 60000;
        responseTimes.push(diffMin);
      }
    } else {
      missedCalls.push(call);
    }
  }

  const avgResponseTime = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length)
    : null;

  const recoveryRate = unansweredCalls.length > 0
    ? Math.round((recoveredCount / unansweredCalls.length) * 1000) / 10
    : 0;

  // Miss rate: unanswered / inbound — excluding weekends (Sat=6, Sun=0)
  const isWeekday = (r: CallRecord) => {
    const day = new Date(r.call_start).getDay();
    return day !== 0 && day !== 6;
  };
  const weekdayInbound = inbound.filter(isWeekday);
  const weekdayUnanswered = unansweredCalls.filter(isWeekday);
  const missRate =
    weekdayInbound.length > 0
      ? Math.round((weekdayUnanswered.length / weekdayInbound.length) * 1000) / 10
      : 0;

  // Avg handle time — inbound (answered, not VM, duration > 0)
  const answeredInbound = records.filter(
    (r) => r.direction === "inbound" && r.endpoint && !r.endpoint.toLowerCase().includes("vm") && Number(r.duration_min || 0) > 0
  );
  const avgDurationInbound =
    answeredInbound.length > 0
      ? Math.round((answeredInbound.reduce((s, r) => s + Number(r.duration_min || 0), 0) / answeredInbound.length) * 10) / 10
      : 0;

  // Avg handle time — outbound (duration > 0)
  const answeredOutbound = outbound.filter((r) => Number(r.duration_min || 0) > 0);
  const avgDurationOutbound =
    answeredOutbound.length > 0
      ? Math.round((answeredOutbound.reduce((s, r) => s + Number(r.duration_min || 0), 0) / answeredOutbound.length) * 10) / 10
      : 0;

  // Combined avg
  const allAnswered = [...answeredInbound, ...answeredOutbound];
  const avgDuration =
    allAnswered.length > 0
      ? Math.round((allAnswered.reduce((s, r) => s + Number(r.duration_min || 0), 0) / allAnswered.length) * 10) / 10
      : 0;

  // Outbound callback rate: % of unanswered calls where team made an outbound callback
  const outboundCallbackRate = unansweredCalls.length > 0
    ? Math.round((responseTimes.length / unansweredCalls.length) * 1000) / 10
    : 0;

  return {
    total_calls: total,
    inbound_calls: inbound.length,
    outbound_calls: outbound.length,
    vm_calls: vmCalls.length,
    missed_calls: unansweredCalls.length,
    miss_rate: missRate,
    callbacks_needed: unansweredCalls.length,
    avg_duration: avgDuration,
    avg_duration_inbound: avgDurationInbound,
    avg_duration_outbound: avgDurationOutbound,
    avg_response_time: avgResponseTime,
    recovery_rate: recoveryRate,
    outbound_callback_rate: outboundCallbackRate,
    outbound_callbacks_made: responseTimes.length,
  };
}

/**
 * Dedup CIK records that are duplicates of Grasshopper forwarded calls.
 * A CIK inbound call is a duplicate if a GH inbound call exists from the
 * same from_number within 120 seconds. GH owns the call (has real caller info).
 */
export function deduplicateRecords<T extends { from_number: string; call_start: string; direction: string; source: string }>(records: T[]): T[] {
  const ghCalls = records.filter((r) => r.source === "grasshopper" && r.direction === "inbound");
  const ghSignatures = new Map<string, number[]>();
  for (const r of ghCalls) {
    const normalized = sanitizePhone(r.from_number) ?? r.from_number;
    const times = ghSignatures.get(normalized) ?? [];
    times.push(new Date(r.call_start).getTime());
    ghSignatures.set(normalized, times);
  }

  if (ghSignatures.size === 0) return records;

  return records.filter((r) => {
    if (r.source !== "cik") return true;
    if (r.direction !== "inbound") return true;

    const normalized = sanitizePhone(r.from_number) ?? r.from_number;
    const ghTimes = ghSignatures.get(normalized);
    if (!ghTimes) return true;

    const cikTime = new Date(r.call_start).getTime();
    const isDuplicate = ghTimes.some((ghTime) => Math.abs(cikTime - ghTime) < 120_000);
    return !isDuplicate;
  });
}
