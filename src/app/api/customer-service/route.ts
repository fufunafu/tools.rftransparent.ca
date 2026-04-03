import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

// Grasshopper scraping takes 2-3 min via Playwright
export const maxDuration = 300;

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

function sanitizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 15) return null;
  // Normalize North American numbers: strip leading country code 1
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

interface CallRecord {
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

function computeMetrics(records: CallRecord[]) {
  const total = records.length;
  const inbound = records.filter((r) => r.direction === "inbound");
  const outbound = records.filter((r) => r.direction === "outbound");
  const vmCalls = inbound.filter(
    (r) => r.endpoint && r.endpoint.toLowerCase().includes("vm")
  );

  // Missed = inbound + no endpoint + no subsequent resolution
  // Resolution = outbound call TO that number OR another inbound call FROM that number that was answered
  // Normalize phone numbers for matching (GH/CIK may store different formats)
  const outboundByNumber = new Map<string, string[]>();
  for (const r of outbound) {
    const key = sanitizePhone(r.to_number) ?? r.to_number;
    const times = outboundByNumber.get(key) ?? [];
    times.push(r.call_start);
    outboundByNumber.set(key, times);
  }

  // Also track answered inbound calls per number (caller called back and got through)
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

  // Missed = inbound calls that were not answered by a person (no endpoint, or voicemail)
  const isVm = (r: CallRecord) => r.endpoint?.toLowerCase().includes("vm");
  const unansweredCalls = inbound.filter((r) => !r.endpoint || isVm(r));

  // For each unanswered call, check if there was a resolution
  const responseTimes: number[] = [];
  let recoveredCount = 0;
  const missedCalls: CallRecord[] = [];

  for (const call of unansweredCalls) {
    const callNumber = sanitizePhone(call.from_number) ?? call.from_number;
    // Check outbound callbacks
    const outboundCbs = outboundByNumber.get(callNumber);
    const outboundAfter = outboundCbs?.filter((t) => t > call.call_start).sort() ?? [];
    // Check if caller called back and was answered
    const answeredCbs = answeredInboundByNumber.get(callNumber);
    const answeredAfter = answeredCbs?.filter((t) => t > call.call_start).sort() ?? [];

    // Check if resolved by either outbound callback or answered inbound
    const hasOutbound = outboundAfter.length > 0;
    const hasAnsweredInbound = answeredAfter.length > 0;
    if (hasOutbound || hasAnsweredInbound) {
      recoveredCount++;
      // Response time only measures outbound callbacks (team effort),
      // not when the customer happens to call back
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

  // Combined avg (backwards compat)
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

const STORES = [
  { id: "bc_transparent", label: "BC Transparent" },
  { id: "rf_transparent", label: "RF Transparent" },
];

/**
 * Dedup CIK records that are duplicates of Grasshopper forwarded calls.
 * A CIK inbound call is a duplicate if a GH inbound call exists from the
 * same from_number within 120 seconds. GH owns the call (has real caller info).
 */
function deduplicateRecords<T extends { from_number: string; call_start: string; direction: string; source: string }>(records: T[]): T[] {
  // Build a set of GH inbound call signatures for fast lookup
  // Use sanitized phone numbers for matching (GH and CIK may store different formats)
  const ghCalls = records.filter((r) => r.source === "grasshopper" && r.direction === "inbound");
  const ghSignatures = new Map<string, number[]>();
  for (const r of ghCalls) {
    const normalized = sanitizePhone(r.from_number) ?? r.from_number;
    const times = ghSignatures.get(normalized) ?? [];
    times.push(new Date(r.call_start).getTime());
    ghSignatures.set(normalized, times);
  }

  if (ghSignatures.size === 0) return records; // No GH calls, nothing to dedup

  return records.filter((r) => {
    // Keep all non-CIK records
    if (r.source !== "cik") return true;
    // Keep all outbound CIK records
    if (r.direction !== "inbound") return true;

    // Check if this CIK inbound call matches a GH call (same number, within 120s)
    const normalized = sanitizePhone(r.from_number) ?? r.from_number;
    const ghTimes = ghSignatures.get(normalized);
    if (!ghTimes) return true; // No GH call from this number

    const cikTime = new Date(r.call_start).getTime();
    const isDuplicate = ghTimes.some((ghTime) => Math.abs(cikTime - ghTime) < 120_000);
    return !isDuplicate;
  });
}

async function fetchRecords(from: string, to: string, storeId: string, source?: string): Promise<CallRecord[]> {
  const supabase = getSupabase();
  const allRecords: CallRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from("call_records")
      .select("*")
      .eq("store_id", storeId)
      .gte("call_start", from + "T00:00:00")
      .lt("call_start", to + "T23:59:59")
      .order("call_start", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (source && source !== "all") {
      query = query.eq("source", source);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    allRecords.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return deduplicateRecords(allRecords);
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view");
  const storeId = req.nextUrl.searchParams.get("store") || STORES[0].id;
  const source = req.nextUrl.searchParams.get("source") || "all";
  const today = toDateStr(new Date());
  const from = req.nextUrl.searchParams.get("from") || today;
  const to = req.nextUrl.searchParams.get("to") || today;

  // Return available stores list
  if (view === "stores") {
    return NextResponse.json({ stores: STORES });
  }

  // --- Customer lookup: full call history for a phone number ---
  if (view === "customer") {
    const number = sanitizePhone(req.nextUrl.searchParams.get("number"));
    if (!number) {
      return NextResponse.json({ error: "Missing or invalid number param" }, { status: 400 });
    }
    try {
      const supabase = getSupabase();
      let customerQuery = supabase
        .from("call_records")
        .select("id,call_start,direction,duration_min,endpoint,source")
        .eq("store_id", storeId)
        .or(`from_number.eq.${number},to_number.eq.${number}`)
        .order("call_start", { ascending: false })
        .limit(200);

      if (source && source !== "all") {
        customerQuery = customerQuery.eq("source", source);
      }

      const { data: calls } = await customerQuery;

      const { data: noteData } = await supabase
        .from("callback_notes")
        .select("note,status")
        .eq("store_id", storeId)
        .eq("from_number", number)
        .limit(1);

      return NextResponse.json({
        calls: calls ?? [],
        note: noteData?.[0]?.note ?? "",
        note_status: noteData?.[0]?.status ?? "",
      });
    } catch (err) {
      console.error("[Customer Lookup]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch customer" },
        { status: 500 }
      );
    }
  }
  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  const rangeDays = Math.max(
    1,
    Math.round((toDate.getTime() - fromDate.getTime()) / 86400000)
  );

  // Previous period
  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - rangeDays);
  const prevFromStr = toDateStr(prevFrom);
  const prevToStr = toDateStr(prevTo);

  // Get last scraper run for this store
  const { data: lastRun } = await getSupabase()
    .from("scraper_runs")
    .select("*")
    .eq("store_id", storeId)
    .order("started_at", { ascending: false })
    .limit(1);

  const lastScrape = lastRun?.[0]
    ? {
        status: lastRun[0].status,
        finishedAt: lastRun[0].finished_at,
        recordsInserted: lastRun[0].records_inserted,
        errorMessage: lastRun[0].error_message,
      }
    : null;

  // Get last scraper run time (most recent successful run for this store)
  const { data: lastRunRow } = await getSupabase()
    .from("scraper_runs")
    .select("finished_at")
    .eq("store_id", storeId)
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);

  // Get latest call record per source (shows data freshness)
  const { data: lastCikRow } = await getSupabase()
    .from("call_records")
    .select("call_start")
    .eq("store_id", storeId)
    .eq("source", "cik")
    .order("call_start", { ascending: false })
    .limit(1);
  const { data: lastGhRow } = await getSupabase()
    .from("call_records")
    .select("call_start")
    .eq("store_id", storeId)
    .eq("source", "grasshopper")
    .order("call_start", { ascending: false })
    .limit(1);
  const lastSync = {
    cik: lastCikRow?.[0]?.call_start || null,
    grasshopper: lastGhRow?.[0]?.call_start || null,
  };

  try {
    // --- Call log view: paginated list of all calls ---
    if (view === "call-log") {
      const page = parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
      const pageSize = 50;
      const offset = (page - 1) * pageSize;

      let query = getSupabase()
        .from("call_records")
        .select("id,call_start,from_number,to_number,direction,duration_min,endpoint,source", { count: "exact" })
        .eq("store_id", storeId)
        .gte("call_start", from + "T00:00:00")
        .lt("call_start", to + "T23:59:59")
        .order("call_start", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (source && source !== "all") {
        query = query.eq("source", source);
      }

      // Direction filter
      const direction = req.nextUrl.searchParams.get("direction") || "all";
      if (direction && direction !== "all") {
        query = query.eq("direction", direction);
      }

      // Status filter (derived from endpoint field)
      const status = req.nextUrl.searchParams.get("status") || "all";
      if (status === "missed") {
        query = query.eq("direction", "inbound").or("endpoint.is.null,endpoint.ilike.%vm%");
      } else if (status === "voicemail") {
        query = query.ilike("endpoint", "%vm%");
      } else if (status === "answered") {
        query = query.not("endpoint", "is", null).not("endpoint", "ilike", "%vm%");
      }

      // Duration range filter
      const minDuration = req.nextUrl.searchParams.get("minDuration");
      const maxDuration = req.nextUrl.searchParams.get("maxDuration");
      if (minDuration) query = query.gte("duration_min", parseFloat(minDuration));
      if (maxDuration) query = query.lte("duration_min", parseFloat(maxDuration));

      // Phone number search (sanitized to digits only)
      const phone = sanitizePhone(req.nextUrl.searchParams.get("phone"));
      if (phone) {
        query = query.or(`from_number.ilike.%${phone}%,to_number.ilike.%${phone}%`);
      }

      const { data: records, count } = await query;

      // First-time caller detection for inbound records on this page
      const inboundNumbers = [...new Set(
        (records ?? []).filter((r) => r.direction === "inbound" && r.from_number !== "unknown").map((r) => r.from_number)
      )];
      const { data: priorLogCallers } = inboundNumbers.length > 0
        ? await getSupabase()
            .from("call_records")
            .select("from_number")
            .eq("store_id", storeId)
            .eq("direction", "inbound")
            .lt("call_start", from + "T00:00:00")
            .in("from_number", inboundNumbers)
        : { data: [] };
      const priorLogSet = new Set((priorLogCallers ?? []).map((r) => r.from_number));

      // Count inbound calls per from_number in the full period for repeat caller detection
      const { data: callCounts } = await getSupabase()
        .from("call_records")
        .select("from_number")
        .eq("store_id", storeId)
        .eq("direction", "inbound")
        .gte("call_start", from + "T00:00:00")
        .lt("call_start", to + "T23:59:59");
      const callCountMap = new Map<string, number>();
      for (const r of callCounts ?? []) {
        callCountMap.set(r.from_number, (callCountMap.get(r.from_number) ?? 0) + 1);
      }

      // Dedup CIK records that duplicate Grasshopper forwarded calls
      const dedupedRecords = deduplicateRecords(records ?? []);
      const removedCount = (records?.length ?? 0) - dedupedRecords.length;
      const adjustedTotal = (count ?? 0) - removedCount;

      return NextResponse.json({
        records: dedupedRecords.map((r) => ({
          ...r,
          is_first_time: r.direction === "inbound" && r.from_number !== "unknown" && !priorLogSet.has(r.from_number),
          call_count: r.direction === "inbound" ? (callCountMap.get(r.from_number) ?? 1) : undefined,
        })),
        total: adjustedTotal,
        page,
        pageSize,
        totalPages: Math.ceil(adjustedTotal / pageSize),
      });
    }

    // --- Callbacks view: grouped by phone number with priority ---
    if (view === "callbacks") {
      const records = await fetchRecords(from, to, storeId, source);
      const inbound = records.filter((r) => r.direction === "inbound");
      const outbound = records.filter((r) => r.direction === "outbound");

      const outboundByNumber = new Map<string, string[]>();
      for (const r of outbound) {
        const times = outboundByNumber.get(r.to_number) ?? [];
        times.push(r.call_start);
        outboundByNumber.set(r.to_number, times);
      }

      // Also track answered inbound calls (caller called back and got through)
      const answeredInboundByNumber = new Map<string, string[]>();
      for (const r of inbound) {
        if (r.endpoint) {
          const times = answeredInboundByNumber.get(r.from_number) ?? [];
          times.push(r.call_start);
          answeredInboundByNumber.set(r.from_number, times);
        }
      }

      const missedCalls = inbound.filter((r) => {
        if (r.endpoint) return false;
        // Check outbound callback
        const outCbs = outboundByNumber.get(r.from_number);
        const hasOutbound = outCbs?.some((t) => t > r.call_start) ?? false;
        // Check if caller called back and was answered
        const inCbs = answeredInboundByNumber.get(r.from_number);
        const hasAnsweredInbound = inCbs?.some((t) => t > r.call_start) ?? false;
        return !hasOutbound && !hasAnsweredInbound;
      });

      // Group by phone number
      const grouped = new Map<string, typeof missedCalls>();
      for (const r of missedCalls) {
        const arr = grouped.get(r.from_number) ?? [];
        arr.push(r);
        grouped.set(r.from_number, arr);
      }

      const callbacks = Array.from(grouped.entries()).map(([number, calls]) => {
        const sorted = calls.sort(
          (a, b) => new Date(b.call_start).getTime() - new Date(a.call_start).getTime()
        );
        const attempts = calls.length;
        const lastCallTime = sorted[0].call_start;

        // Response time: time from last missed call to first outbound callback
        let response_time_min: number | null = null;
        const cbs = outboundByNumber.get(number);
        if (cbs) {
          const afterTimes = cbs.filter((t) => t > lastCallTime).sort();
          if (afterTimes.length > 0) {
            response_time_min = Math.round(
              (new Date(afterTimes[0]).getTime() - new Date(lastCallTime).getTime()) / 60000
            );
          }
        }

        return {
          from_number: number,
          attempts,
          priority: attempts >= 3 ? "high" : attempts === 2 ? "medium" : "low",
          last_call: lastCallTime,
          first_call: sorted[sorted.length - 1].call_start,
          total_duration: Math.round(calls.reduce((s, c) => s + Number(c.duration_min || 0), 0) * 10) / 10,
          response_time_min,
          calls: sorted.map((c) => ({
            id: c.id,
            call_start: c.call_start,
            duration_min: c.duration_min,
            source: c.source,
          })),
        };
      });

      // Sort: high priority first, then medium, then low; within same priority, most recent first
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      callbacks.sort((a, b) => {
        const pd = priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder];
        if (pd !== 0) return pd;
        return new Date(b.last_call).getTime() - new Date(a.last_call).getTime();
      });

      // Enrich with notes and first-time detection
      const callbackNumbers = callbacks.map((c) => c.from_number);
      const [{ data: notes }, { data: priorCallbackCallers }] = await Promise.all([
        getSupabase()
          .from("callback_notes")
          .select("from_number,note,status")
          .eq("store_id", storeId)
          .in("from_number", callbackNumbers.length > 0 ? callbackNumbers : [""]),
        getSupabase()
          .from("call_records")
          .select("from_number")
          .eq("store_id", storeId)
          .eq("direction", "inbound")
          .lt("call_start", from + "T00:00:00")
          .in("from_number", callbackNumbers.length > 0 ? callbackNumbers : [""]),
      ]);

      const noteMap = new Map<string, { note: string; status: string }>();
      for (const n of notes ?? []) {
        noteMap.set(n.from_number, { note: n.note, status: n.status });
      }
      const priorCallbackSet = new Set((priorCallbackCallers ?? []).map((r) => r.from_number));

      const enrichedCallbacks = callbacks.map((cb) => {
        const n = noteMap.get(cb.from_number);
        return { ...cb, note: n?.note ?? "", note_status: n?.status ?? "", is_first_time: !priorCallbackSet.has(cb.from_number) };
      });

      return NextResponse.json({
        callbacks: enrichedCallbacks,
        totalMissed: missedCalls.length,
        uniqueCallers: grouped.size,
        highPriority: callbacks.filter((c) => c.priority === "high").length,
        lastScrape,
        lastSync,
      });
    }

    // --- Patterns view: hourly + daily aggregates ---
    if (view === "patterns") {
      const records = await fetchRecords(from, to, storeId, source);

      // Missed = inbound call not answered by a person (no endpoint, or voicemail)
      const isMissed = (r: CallRecord) => {
        return r.direction === "inbound" && (!r.endpoint || r.endpoint.toLowerCase().includes("vm"));
      };

      // Hourly aggregation
      const hourLabels = [
        "12 AM","1 AM","2 AM","3 AM","4 AM","5 AM","6 AM","7 AM","8 AM","9 AM","10 AM","11 AM",
        "12 PM","1 PM","2 PM","3 PM","4 PM","5 PM","6 PM","7 PM","8 PM","9 PM","10 PM","11 PM",
      ];
      const hourly = Array.from({ length: 24 }, (_, h) => ({
        hour: h, label: hourLabels[h], total_calls: 0, inbound: 0, missed: 0, answered: 0, miss_rate: 0,
      }));

      // Convert timestamp to Eastern Time hour.
      // CIK timestamps are UTC (+00:00), Grasshopper are naive (already ET).
      const getETHour = (ts: string) => {
        if (ts.includes("+") || ts.includes("Z")) {
          // UTC timestamp — convert to ET
          const d = new Date(ts);
          const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
          return et.getHours();
        }
        // Naive timestamp (Grasshopper) — already in ET
        const match = ts.match(/T(\d{2}):/);
        return match ? parseInt(match[1], 10) : new Date(ts).getHours();
      };

      for (const r of records) {
        const h = getETHour(r.call_start);
        hourly[h].total_calls++;
        if (r.direction === "inbound") {
          hourly[h].inbound++;
          if (isMissed(r)) {
            hourly[h].missed++;
          } else if (r.endpoint && !r.endpoint.toLowerCase().includes("vm")) {
            hourly[h].answered++;
          }
        }
      }
      for (const h of hourly) {
        h.miss_rate = h.inbound > 0 ? Math.round((h.missed / h.inbound) * 1000) / 10 : 0;
      }

      // Daily (day-of-week) aggregation
      const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const daily = Array.from({ length: 7 }, (_, d) => ({
        day: d, label: dayLabels[d], total_calls: 0, missed: 0, miss_rate: 0, dayCount: 0,
      }));

      // Count how many of each weekday exist in the range
      const start = new Date(from + "T00:00:00");
      const end = new Date(to + "T23:59:59");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        daily[d.getDay()].dayCount++;
      }

      for (const r of records) {
        // Convert to ET date to get correct day-of-week
        let dow: number;
        if (r.call_start.includes("+") || r.call_start.includes("Z")) {
          const etDate = new Date(new Date(r.call_start).toLocaleString("en-US", { timeZone: "America/New_York" }));
          dow = etDate.getDay();
        } else {
          const [y, m, d] = r.call_start.split("T")[0].split("-").map(Number);
          dow = new Date(y, m - 1, d).getDay();
        }
        daily[dow].total_calls++;
        if (isMissed(r)) daily[dow].missed++;
      }
      for (const d of daily) {
        d.miss_rate = d.total_calls > 0 ? Math.round((d.missed / d.total_calls) * 1000) / 10 : 0;
      }

      // Reorder to start from Monday
      const reordered = [...daily.slice(1), daily[0]];

      return NextResponse.json({ hourly, daily: reordered, lastScrape, lastSync });
    }

    // --- History view: daily aggregates for charts ---
    if (view === "history") {
      const records = await fetchRecords(from, to, storeId, source);
      const byDate = new Map<
        string,
        { total: number; inbound: number; outbound: number; missed: number; vm: number }
      >();

      // Pre-fill all dates in range so days with zero calls still appear
      const rangeStart = new Date(from + "T00:00:00");
      const rangeEnd = new Date(to + "T00:00:00");
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split("T")[0];
        byDate.set(key, { total: 0, inbound: 0, outbound: 0, missed: 0, vm: 0 });
      }

      // Group records by date
      for (const r of records) {
        const d = r.call_start.split("T")[0];
        const day = byDate.get(d) ?? {
          total: 0,
          inbound: 0,
          outbound: 0,
          missed: 0,
          vm: 0,
        };
        day.total++;
        if (r.direction === "inbound") {
          day.inbound++;
          if (r.endpoint?.toLowerCase().includes("vm")) {
            day.vm++;
          }
        } else {
          day.outbound++;
        }
        byDate.set(d, day);
      }

      // Calculate missed calls per day: inbound with no endpoint or voicemail
      for (const r of records) {
        if (r.direction !== "inbound") continue;
        if (r.endpoint && !r.endpoint.toLowerCase().includes("vm")) continue;
        const d = r.call_start.split("T")[0];
        const day = byDate.get(d);
        if (day) day.missed++;
      }

      // Convert to sorted daily array
      const dailyHistory = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({
          date,
          total_calls: day.total,
          inbound: day.inbound,
          outbound: day.outbound,
          missed: day.missed,
          vm_calls: day.vm,
          miss_rate: day.inbound > 0 ? Math.round((day.missed / day.inbound) * 1000) / 10 : 0,
        }));

      // Smooth data based on date range span to reduce noise
      // Up to 14 days: daily points, 15-60 days: 3-day rolling avg, 61+: weekly rolling avg
      const totalDays = dailyHistory.length;
      const bucketSize = totalDays <= 14 ? 1 : totalDays <= 60 ? 3 : 7;

      const history = [];
      for (let i = 0; i < dailyHistory.length; i += bucketSize) {
        const bucket = dailyHistory.slice(i, i + bucketSize);
        const totalCalls = bucket.reduce((s, d) => s + d.total_calls, 0);
        const totalInbound = bucket.reduce((s, d) => s + d.inbound, 0);
        const totalOutbound = bucket.reduce((s, d) => s + d.outbound, 0);
        const totalMissed = bucket.reduce((s, d) => s + d.missed, 0);
        const totalVm = bucket.reduce((s, d) => s + d.vm_calls, 0);
        // Use the middle date of the bucket as label
        const midDate = bucket[Math.floor(bucket.length / 2)].date;
        history.push({
          date: midDate,
          total_calls: totalCalls,
          inbound: totalInbound,
          outbound: totalOutbound,
          missed: totalMissed,
          vm_calls: totalVm,
          miss_rate: totalInbound > 0 ? Math.round((totalMissed / totalInbound) * 1000) / 10 : 0,
        });
      }

      return NextResponse.json({ history, lastScrape, lastSync });
    }

    // --- Summary view (default) ---
    const [currentRecords, previousRecords] = await Promise.all([
      fetchRecords(from, to, storeId, source),
      fetchRecords(prevFromStr, prevToStr, storeId, source),
    ]);

    const current = computeMetrics(currentRecords);
    const previous = computeMetrics(previousRecords);

    // First-time vs returning callers
    const currentInboundNumbers = new Set(
      currentRecords.filter((r) => r.direction === "inbound" && r.from_number !== "unknown").map((r) => r.from_number)
    );
    // Fetch all inbound numbers that called BEFORE this period (batched to avoid URL length limits)
    const numbersList = Array.from(currentInboundNumbers);
    const priorSet = new Set<string>();
    const BATCH_SIZE = 50;
    for (let i = 0; i < numbersList.length; i += BATCH_SIZE) {
      const batch = numbersList.slice(i, i + BATCH_SIZE);
      const { data: priorBatch } = await getSupabase()
        .from("call_records")
        .select("from_number")
        .eq("store_id", storeId)
        .eq("direction", "inbound")
        .lt("call_start", from + "T00:00:00")
        .in("from_number", batch);
      if (priorBatch) {
        for (const r of priorBatch) priorSet.add(r.from_number);
      }
    }
    const firstTimeCallers = numbersList.filter((n) => !priorSet.has(n)).length;
    const returningCallers = numbersList.filter((n) => priorSet.has(n)).length;

    return NextResponse.json({
      current: { ...current, first_time_callers: firstTimeCallers, returning_callers: returningCallers },
      previous,
      change: {
        total_calls: pctChange(current.total_calls, previous.total_calls),
        inbound_calls: pctChange(current.inbound_calls, previous.inbound_calls),
        outbound_calls: pctChange(
          current.outbound_calls,
          previous.outbound_calls
        ),
        vm_calls: pctChange(current.vm_calls, previous.vm_calls),
        missed_calls: pctChange(current.missed_calls, previous.missed_calls),
        miss_rate: pctChange(current.miss_rate, previous.miss_rate),
        callbacks_needed: pctChange(
          current.callbacks_needed,
          previous.callbacks_needed
        ),
        avg_duration: pctChange(current.avg_duration, previous.avg_duration),
        avg_duration_inbound: pctChange(current.avg_duration_inbound, previous.avg_duration_inbound),
        avg_duration_outbound: pctChange(current.avg_duration_outbound, previous.avg_duration_outbound),
        outbound_callback_rate: pctChange(current.outbound_callback_rate, previous.outbound_callback_rate),
      },
      dateRange: {
        current: { from, to },
        previous: { from: prevFromStr, to: prevToStr },
      },
      lastScrape,
      lastSync,
      stores: STORES,
    });
  } catch (err) {
    console.error("[Customer Service API]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to fetch call data",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view");

  // --- Save/update callback note ---
  if (view === "note") {
    try {
      const body = await req.json();
      const { store_id, from_number, note, status } = body;
      if (!store_id || !from_number) {
        return NextResponse.json({ error: "Missing store_id or from_number" }, { status: 400 });
      }
      const { data, error } = await getSupabase()
        .from("callback_notes")
        .upsert(
          {
            store_id,
            from_number,
            note: note ?? "",
            status: status ?? "pending",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "store_id,from_number" }
        )
        .select();

      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, data });
    } catch (err) {
      console.error("[Callback Note]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to save note" },
        { status: 500 }
      );
    }
  }

  // Proxy refresh request to the scraper service
  const scraperUrl = process.env.SCRAPER_URL;
  const scraperKey = process.env.SCRAPER_API_KEY;

  if (!scraperUrl) {
    return NextResponse.json(
      { error: "Scraper service not configured" },
      { status: 503 }
    );
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (scraperKey) {
      headers["Authorization"] = `Bearer ${scraperKey}`;
    }

    const store = req.nextUrl.searchParams.get("store") || "";
    const scraper = req.nextUrl.searchParams.get("scraper") || "cik";
    const code = req.nextUrl.searchParams.get("code") || "";

    const endpoint = scraper === "grasshopper" ? "/scrape-grasshopper" : "/scrape";
    const params = new URLSearchParams();
    if (store) params.set("store", store);
    if (code && scraper === "grasshopper") params.set("code", code);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const url = `${scraperUrl}${endpoint}${qs}`;
    console.log(`[Scraper] POST ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
    });

    const responseText = await response.text();

    // Try to parse as JSON, but handle HTML error pages gracefully
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      // Scraper returned non-JSON (e.g., Render error page, timeout HTML)
      const preview = responseText.slice(0, 200).replace(/<[^>]*>/g, "").trim();
      console.error(`[Scraper] Non-JSON response (${response.status}): ${preview}`);
      return NextResponse.json(
        {
          status: "error",
          error: `Scraper returned HTTP ${response.status}: ${preview || "empty response"}`,
          logs: [
            `Request: POST ${url}`,
            `Response status: ${response.status} ${response.statusText}`,
            `Response body (not JSON): ${preview || "(empty)"}`,
          ],
        },
        { status: 502 }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Customer Service Refresh]", message);
    return NextResponse.json(
      {
        status: "error",
        error: `Failed to reach scraper service: ${message}`,
        logs: [
          `Scraper URL: ${scraperUrl}`,
          `Error: ${message}`,
          "The scraper service may be down, restarting, or timed out.",
          "Check Render dashboard for service status.",
        ],
      },
      { status: 500 }
    );
  }
}
