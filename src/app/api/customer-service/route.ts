import { NextRequest, NextResponse } from "next/server";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { sanitizePhone, pctChange, computeMetrics, deduplicateRecords } from "@/lib/call-metrics";
import type { CallRecord } from "@/lib/call-metrics";
import { syncLeadCallStatuses } from "@/lib/lead-call-sync";

// Grasshopper scraping takes 2-3 min via Playwright
export const maxDuration = 300;

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

// Call-date windows anchor to the business timezone (Montreal / Eastern), not
// the server's UTC clock. A "YYYY-MM-DD" from the client is a Montreal calendar
// day, so its DB bounds must be Montreal midnight → next Montreal midnight,
// otherwise "Today" at 9 PM EDT would start at the wrong (UTC) instant.
const BUSINESS_TZ = "America/Toronto";

/** UTC instant of midnight (start of day) in BUSINESS_TZ for a YYYY-MM-DD. */
function dayStartUTC(ymd: string): string {
  const wallAsUTC = new Date(`${ymd}T00:00:00Z`).getTime();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(wallAsUTC));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const easternAsUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return new Date(wallAsUTC - (easternAsUTC - wallAsUTC)).toISOString();
}

/** Exclusive upper bound: Montreal midnight of the day AFTER ymd. */
function dayEndUTC(ymd: string): string {
  const next = new Date(`${ymd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return dayStartUTC(next.toISOString().slice(0, 10));
}

const STORES = [
  { id: "bc_transparent", label: "BC Transparent" },
  { id: "rf_transparent", label: "RF Transparent" },
];

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
      .gte("call_start", dayStartUTC(from))
      .lt("call_start", dayEndUTC(to))
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
        .gte("call_start", dayStartUTC(from))
        .lt("call_start", dayEndUTC(to))
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
            .lt("call_start", dayStartUTC(from))
            .in("from_number", inboundNumbers)
        : { data: [] };
      const priorLogSet = new Set((priorLogCallers ?? []).map((r) => r.from_number));

      // Count inbound calls per from_number in the full period for repeat caller detection
      const { data: callCounts } = await getSupabase()
        .from("call_records")
        .select("from_number")
        .eq("store_id", storeId)
        .eq("direction", "inbound")
        .gte("call_start", dayStartUTC(from))
        .lt("call_start", dayEndUTC(to));
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

      const isVmCall = (r: CallRecord) => r.endpoint?.toLowerCase().includes("vm");

      const outboundByNumber = new Map<string, string[]>();
      for (const r of outbound) {
        const key = sanitizePhone(r.to_number) ?? r.to_number;
        const times = outboundByNumber.get(key) ?? [];
        times.push(r.call_start);
        outboundByNumber.set(key, times);
      }

      // Also track answered inbound calls (caller called back and got through)
      // Exclude voicemail — leaving a VM is not a real resolution
      const answeredInboundByNumber = new Map<string, string[]>();
      for (const r of inbound) {
        if (r.endpoint && !isVmCall(r)) {
          const key = sanitizePhone(r.from_number) ?? r.from_number;
          const times = answeredInboundByNumber.get(key) ?? [];
          times.push(r.call_start);
          answeredInboundByNumber.set(key, times);
        }
      }

      // Missed = inbound with no endpoint OR voicemail (consistent with computeMetrics)
      const CALLBACK_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
      const missedCalls = inbound.filter((r) => {
        if (r.endpoint && !isVmCall(r)) return false;
        const callNumber = sanitizePhone(r.from_number) ?? r.from_number;
        const callTime = new Date(r.call_start).getTime();
        const cutoff = new Date(callTime + CALLBACK_WINDOW_MS).toISOString();
        // Check outbound callback (within 48h)
        const outCbs = outboundByNumber.get(callNumber);
        const hasOutbound = outCbs?.some((t) => t > r.call_start && t < cutoff) ?? false;
        // Check if caller called back and was answered (within 48h)
        const inCbs = answeredInboundByNumber.get(callNumber);
        const hasAnsweredInbound = inCbs?.some((t) => t > r.call_start && t < cutoff) ?? false;
        return !hasOutbound && !hasAnsweredInbound;
      });

      // Group by sanitized phone number
      const grouped = new Map<string, typeof missedCalls>();
      for (const r of missedCalls) {
        const key = sanitizePhone(r.from_number) ?? r.from_number;
        const arr = grouped.get(key) ?? [];
        arr.push(r);
        grouped.set(key, arr);
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
          .lt("call_start", dayStartUTC(from))
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
        day: d, label: dayLabels[d], total_calls: 0, inbound: 0, missed: 0, miss_rate: 0, dayCount: 0,
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
        if (r.direction === "inbound") daily[dow].inbound++;
        if (isMissed(r)) daily[dow].missed++;
      }
      for (const d of daily) {
        d.miss_rate = d.inbound > 0 ? Math.round((d.missed / d.inbound) * 1000) / 10 : 0;
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
        .lt("call_start", dayStartUTC(from))
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
        total_minutes: pctChange(current.total_minutes, previous.total_minutes),
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
  const action = req.nextUrl.searchParams.get("action");

  // Complete the second half of a manual phone import by matching the newly
  // stored call records to leads. Keep this server-side and admin-only so the
  // browser never needs the cron secret.
  if (action === "sync-lead-calls") {
    if (!(await isAdminUser())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const summary = await syncLeadCallStatuses();
      return NextResponse.json({ status: "success", lead_call_sync: summary });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Lead call matching failed" },
        { status: 500 },
      );
    }
  }

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
