"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { calculateCallbackCompletion } from "@/lib/call-metrics";

// Charts are split out so recharts loads on demand instead of in the
// route's initial bundle (same pattern as ShopifyCharts).
const CallVolumeChart = dynamic(
  () => import("./CustomerServiceCharts").then((m) => ({ default: m.CallVolumeChart })),
  { ssr: false, loading: () => <div className="h-full animate-pulse" /> },
);
const MissRateChart = dynamic(
  () => import("./CustomerServiceCharts").then((m) => ({ default: m.MissRateChart })),
  { ssr: false, loading: () => <div className="h-full animate-pulse" /> },
);
const PeakHoursChart = dynamic(
  () => import("./CustomerServiceCharts").then((m) => ({ default: m.PeakHoursChart })),
  { ssr: false, loading: () => <div className="h-full animate-pulse" /> },
);

type Range = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";
interface Metrics {
  total_calls: number;
  inbound_calls: number;
  outbound_calls: number;
  vm_calls: number;
  missed_calls: number;
  miss_rate: number;
  callbacks_needed: number;
  avg_duration: number;
  avg_duration_inbound: number;
  avg_duration_outbound: number;
  avg_response_time: number | null;
  recovery_rate: number;
  outbound_callback_rate: number;
  outbound_callbacks_made: number;
  first_time_callers: number;
  returning_callers: number;
  total_minutes: number;
  inbound_minutes: number;
  outbound_minutes: number;
}

interface SummaryResponse {
  current: Metrics;
  previous: Metrics;
  change: Record<string, number | null>;
  dateRange: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
  };
  lastScrape: {
    status: string;
    finishedAt: string | null;
    recordsInserted: number;
    errorMessage: string | null;
  } | null;
  lastSync?: {
    cik: string | null;
    grasshopper: string | null;
  };
}

interface HistoryPoint {
  date: string;
  total_calls: number;
  inbound: number;
  outbound: number;
  missed: number;
  vm_calls: number;
  miss_rate: number;
}

interface HourlyPoint {
  hour: number;
  label: string;
  total_calls: number;
  inbound: number;
  missed: number;
  answered: number;
  miss_rate: number;
}

interface DailyPoint {
  day: number;
  label: string;
  total_calls: number;
  missed: number;
  miss_rate: number;
  dayCount: number;
}

interface CallbackGroup {
  from_number: string;
  attempts: number;
  priority: string;
  last_call: string;
  first_call: string;
  total_duration: number;
  response_time_min?: number | null;
  is_first_time?: boolean;
  calls: { id: string; call_start: string; duration_min: number; source?: string }[];
  note?: string;
  note_status?: string;
  assigned_to?: string | null;
}

interface CallbacksResponse {
  callbacks: CallbackGroup[];
  totalMissed: number;
  uniqueCallers: number;
  highPriority: number;
}

interface GrasshopperDiagnostics {
  csv_lines: number;
  csv_bytes: number;
  csv_data_rows: number;
  total_parsed: number;
  total_skipped: number;
  csv_date_range?: {
    earliest: string;
    latest: string;
  };
  per_store?: Record<string, {
    count: number;
    earliest: string;
    latest: string;
  }>;
}

// Dates are Montreal (Eastern) calendar days, not UTC — otherwise after ~8 PM
// EDT "today" would already roll to the next UTC date and the API would return
// the wrong day's calls. en-CA formats as YYYY-MM-DD.
const BUSINESS_TZ = "America/Toronto";
const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayStr() {
  return ymdFmt.format(new Date());
}

function daysAgoStr(n: number) {
  return ymdFmt.format(new Date(Date.now() - n * 86400000));
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

// Total minutes → "Xh Ym" (or "Ym" when under an hour).
function formatMinutesLong(mins: number): string {
  if (!mins || mins <= 0) return "0 min";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatSyncTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function PhoneLink({
  number,
  className = "",
  onClick,
}: {
  number: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const digits = number.replace(/\D/g, "");
  const href = `tel:${digits.length === 10 ? "+1" + digits : "+" + digits}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
        }}
        className={`font-medium text-sand-900 hover:text-sand-600 transition-colors cursor-pointer ${className}`}
      >
        {formatPhoneNumber(number)}
      </button>
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="text-sand-400 hover:text-sand-600 transition-colors"
        title="Call this number"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      </a>
    </span>
  );
}

function ChangeBadge({
  value,
  invert,
}: {
  value: number | null;
  invert?: boolean;
}) {
  if (value === null) return <span className="text-sand-300">--</span>;
  const isPositive = invert ? value < 0 : value > 0;
  const isNegative = invert ? value > 0 : value < 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium ${
        isPositive
          ? "text-green-700"
          : isNegative
            ? "text-red-600"
            : "text-sand-400"
      }`}
    >
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}

const RANGE_OPTIONS: { value: Range; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "yesterday", label: "Yesterday", days: 1 },
  { value: "7d", label: "7 Days", days: 7 },
  { value: "30d", label: "30 Days", days: 30 },
  { value: "90d", label: "90 Days", days: 90 },
];

function formatResponseTime(mins: number): string {
  if (mins == null || mins === 0) return "N/A";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const STORE_OPTIONS = [
  { id: "bc_transparent", label: "BC Transparent" },
  { id: "rf_transparent", label: "RF Transparent" },
];

type Source = "all" | "cik" | "grasshopper";

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: "all", label: "All" },
  { value: "cik", label: "CIK" },
  { value: "grasshopper", label: "Grasshopper" },
];

const BENCHMARKS = [
  {
    key: "miss_rate" as const,
    label: "Miss Rate",
    low: 10,
    high: 20,
    unit: "%",
    industry: "10-20%",
    tooltip: "Percentage of inbound calls that were not answered and did not go to voicemail. Calculated as: unanswered calls \u00f7 inbound calls \u00d7 100. Below 10% is excellent, above 20% needs attention.",
    invert: false,
    getValue: (m: Metrics) => m.miss_rate,
  },
  {
    key: "recovery_rate" as const,
    label: "Recovery Rate",
    low: 60,
    high: 80,
    unit: "%",
    industry: "60-80%",
    tooltip: "Percentage of unanswered callers who were called back. Calculated as: callers who received a callback \u00f7 total unanswered calls \u00d7 100. Higher is better \u2014 above 80% is excellent.",
    invert: true,
    getValue: (m: Metrics) => m.recovery_rate,
  },
  {
    key: "avg_response_time" as const,
    label: "Avg Response Time",
    low: 15,
    high: 60,
    unit: " min",
    industry: "15-60 min",
    tooltip: "Average time in minutes between an unanswered call and the callback to that caller. Only includes calls that were actually called back. Under 15 min is excellent, over 60 min needs improvement.",
    invert: false,
    getValue: (m: Metrics) => m.avg_response_time ?? 0,
  },
  {
    key: "avg_duration" as const,
    label: "Avg Handle Time",
    low: 4,
    high: 6,
    unit: " min",
    industry: "4-6 min",
    tooltip: "Average length of answered calls in minutes. Measures how long each conversation takes. 4\u20136 min is typical for service calls \u2014 too short may mean rushing, too long may mean inefficiency.",
    invert: false,
    getValue: (m: Metrics) => m.avg_duration,
  },
  {
    key: "callback_rate" as const,
    label: "Callback Rate",
    low: 5,
    high: 15,
    unit: "%",
    industry: "5-15%",
    tooltip: "Percentage of inbound callers who went unanswered. Calculated as: unanswered calls \u00f7 total inbound calls \u00d7 100. Lower is better \u2014 means more calls are answered on the first try.",
    invert: false,
    getValue: (m: Metrics) =>
      m.inbound_calls > 0
        ? Math.round((m.callbacks_needed / m.inbound_calls) * 1000) / 10
        : 0,
  },
];

function getBenchmarkLevel(value: number, low: number, high: number, invert?: boolean) {
  if (invert) {
    // Higher is better (e.g. Recovery Rate)
    if (value >= high) return { color: "text-green-700", bg: "bg-green-500", label: "Good" };
    if (value >= low) return { color: "text-yellow-600", bg: "bg-yellow-500", label: "Average" };
    if (value >= low / 2) return { color: "text-orange-600", bg: "bg-orange-500", label: "Below avg" };
    return { color: "text-red-600", bg: "bg-red-500", label: "Critical" };
  }
  // Lower is better (e.g. Miss Rate)
  if (value <= low) return { color: "text-green-700", bg: "bg-green-500", label: "Good" };
  if (value <= high) return { color: "text-yellow-600", bg: "bg-yellow-500", label: "Average" };
  if (value <= high * 2) return { color: "text-orange-600", bg: "bg-orange-500", label: "Above avg" };
  return { color: "text-red-600", bg: "bg-red-500", label: "Critical" };
}

function getBenchmarkInsight(label: string, value: number, low: number, high: number, industry: string, invert?: boolean) {
  if (invert) {
    if (value >= high) return `Your ${label.toLowerCase()} of ${value} is above the industry average of ${industry} — great work.`;
    if (value >= low) return `Your ${label.toLowerCase()} of ${value} is within the industry average of ${industry}.`;
    if (value >= low / 2) return `Your ${label.toLowerCase()} of ${value} is below the industry average of ${industry}.`;
    return `Your ${label.toLowerCase()} of ${value} is significantly below the industry average of ${industry} — needs attention.`;
  }
  if (value <= low) return `Your ${label.toLowerCase()} of ${value} is below the industry average of ${industry} — great work.`;
  if (value <= high) return `Your ${label.toLowerCase()} of ${value} is within the industry average of ${industry}.`;
  if (value <= high * 2) return `Your ${label.toLowerCase()} of ${value} is above the industry average of ${industry}.`;
  return `Your ${label.toLowerCase()} of ${value} is significantly above the industry average of ${industry} — needs attention.`;
}

type Mode = "staff" | "admin";

export default function CustomerServiceDashboard({ defaultStore }: { defaultStore?: string }) {
  const [store, setStore] = useState(defaultStore || STORE_OPTIONS[0].id);
  const [mode, setMode] = useState<Mode>("staff");
  const [mounted, setMounted] = useState(false);

  // Restore saved preferences on mount (after hydration)
  useEffect(() => {
    const savedStore = localStorage.getItem("cs_store");
    if (savedStore && STORE_OPTIONS.some((s) => s.id === savedStore)) {
      setStore(savedStore);
    }
    const savedMode = localStorage.getItem("cs_mode");
    if (savedMode === "staff" || savedMode === "admin") {
      setMode(savedMode);
    }
    setMounted(true);
  }, []);

  const handleModeChange = (m: Mode) => {
    setMode(m);
    localStorage.setItem("cs_mode", m);
  };

  const [source, setSource] = useState<Source>("all");
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [callbackData, setCallbackData] = useState<CallbacksResponse | null>(null);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [ghScraping, setGhScraping] = useState(false);
  const [ghStatus, setGhStatus] = useState("");
  const [ghElapsed, setGhElapsed] = useState(0);
  const [gh2faNeeded, setGh2faNeeded] = useState(false);
  const [gh2faCode, setGh2faCode] = useState("");
  const [ghError, setGhError] = useState("");
  const [ghLogs, setGhLogs] = useState<string[]>([]);
  const [ghDiagnostics, setGhDiagnostics] = useState<GrasshopperDiagnostics | null>(null);
  const [syncKey, setSyncKey] = useState(0);
  const [syncSchedule, setSyncSchedule] = useState<{ enabled: boolean; hours: number[]; timezone: string } | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  const from =
    range === "custom" ? customFrom
    : range === "today" ? todayStr()
    : range === "yesterday" ? daysAgoStr(1)
    : daysAgoStr(RANGE_OPTIONS.find((r) => r.value === range)?.days ?? 7);
  // "Yesterday" is a single calendar day, so its window ends yesterday too.
  const to =
    range === "custom" ? customTo
    : range === "yesterday" ? daysAgoStr(1)
    : todayStr();

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/customer-service?store=${store}&source=${source}&from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to load metrics");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [store, source, from, to]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/customer-service?view=history&store=${store}&source=${source}&from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to load history");
      const json = await res.json();
      setHistory(json.history ?? []);
    } catch {
      // non-critical
    }
  }, [store, source, from, to]);

  const loadCallbacks = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/customer-service?view=callbacks&store=${store}&source=${source}&from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to load callbacks");
      const json = await res.json();
      setCallbackData(json);
    } catch {
      // non-critical
    }
  }, [store, source, from, to]);

  const loadPatterns = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/customer-service?view=patterns&store=${store}&source=${source}&from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to load patterns");
      const json = await res.json();
      setHourly(json.hourly ?? []);
      setDaily(json.daily ?? []);
    } catch {
      // non-critical
    }
  }, [store, source, from, to]);

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([loadSummary(), loadHistory(), loadCallbacks(), loadPatterns()]).finally(() =>
      setLoading(false)
    );
  }, [loadSummary, loadHistory, loadCallbacks, loadPatterns]);

  // Background refresh: the loaders never touch `loading`, so ticks repaint
  // the numbers without flashing the skeleton.
  useAutoRefresh(
    () =>
      Promise.all([loadSummary(), loadHistory(), loadCallbacks(), loadPatterns()]).then(() => {}),
    { intervalMs: 60_000 }
  );

  // Load sync schedule
  useEffect(() => {
    fetch("/api/settings/sync-schedule").then((r) => r.ok ? r.json() : null).then((s) => {
      if (s) setSyncSchedule(s);
    }).catch(() => {});
  }, []);

  const saveSyncSchedule = async (updated: { enabled: boolean; hours: number[]; timezone: string }) => {
    // Optimistic, but the schedule is admin-only to change — roll the toggle
    // back if the server says no, rather than showing a setting that didn't
    // actually save.
    const previous = syncSchedule;
    setSyncSchedule(updated);
    try {
      const res = await fetch("/api/settings/sync-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        setSyncSchedule(previous);
        setError(
          res.status === 403
            ? "Only admins can change the sync schedule."
            : "Couldn't save the sync schedule."
        );
      }
    } catch {
      setSyncSchedule(previous);
      setError("Couldn't save the sync schedule.");
    }
  };

  const toggleScheduleHour = (hour: number) => {
    if (!syncSchedule) return;
    const hours = syncSchedule.hours.includes(hour)
      ? syncSchedule.hours.filter((h) => h !== hour)
      : [...syncSchedule.hours, hour];
    saveSyncSchedule({ ...syncSchedule, hours });
  };

  const handleGhScrape = async (code?: string) => {
    setGhScraping(true);
    setGhElapsed(0);
    setGhError("");
    setGhLogs([]);
    setGhDiagnostics(null);
    setGh2faNeeded(false);
    setGhStatus("");
    const timer = setInterval(() => {
      setGhElapsed((prev) => prev + 1);
    }, 1000);
    try {
      const codeParam = code ? `&code=${encodeURIComponent(code)}` : "";
      const res = await fetch(
        `/api/customer-service?scraper=grasshopper${codeParam}`,
        { method: "POST" }
      );
      const json = await res.json();
      if (json.logs) setGhLogs(json.logs);
      if (json.diagnostics) setGhDiagnostics(json.diagnostics);
      if (json.status === "2fa_required") {
        setGh2faNeeded(true);
        setGhStatus("Verification code needed — check your email");
      } else if (json.status === "success" || json.status === "partial_error") {
        const storeResults = (json.stores ?? [])
          .map((s: { store_id: string; records_inserted?: number; status: string; error?: string }) =>
            `${s.store_id}: ${s.status === "success" ? `${s.records_inserted ?? 0} records` : `error — ${s.error}`}`
          )
          .join(", ");
        setGhStatus(`Done — ${json.records_inserted ?? 0} records synced${storeResults ? ` (${storeResults})` : ""}`);
        setGh2faCode("");
        setSyncKey((k) => k + 1);
        if (json.status === "partial_error") {
          const errors = (json.stores ?? []).filter((s: { status: string }) => s.status === "error");
          if (errors.length > 0) {
            setGhError(errors.map((s: { store_id: string; error: string }) => `${s.store_id}: ${s.error}`).join("\n"));
          }
        }
        await Promise.all([loadSummary(), loadHistory(), loadCallbacks(), loadPatterns()]);
      } else if (json.status === "already_running") {
        setGhStatus("A scrape is already in progress, try again in a few minutes");
      } else {
        setGhStatus("Scrape failed");
        setGhError(json.error || JSON.stringify(json));
      }
    } catch (err) {
      setGhStatus("Failed to reach scraper service");
      setGhError(err instanceof Error ? err.message : "Network error");
    } finally {
      clearInterval(timer);
      setGhScraping(false);
      // Status persists until page refresh
    }
  };

  // Sync All: CIK (both stores) + Grasshopper (all stores) in one click
  const [syncAllRunning, setSyncAllRunning] = useState(false);
  const [syncAllElapsed, setSyncAllElapsed] = useState(0);
  const [syncAllStatus, setSyncAllStatus] = useState("");

  const handleSyncAll = async () => {
    setSyncAllRunning(true);
    setSyncAllElapsed(0);
    setSyncAllStatus("");
    setGhStatus("");
    setGhError("");
    setGhLogs([]);
    setGhDiagnostics(null);

    const timer = setInterval(() => {
      setSyncAllElapsed((prev) => prev + 1);
    }, 1000);

    const results: string[] = [];

    try {
      // Run CIK for all stores in parallel, then Grasshopper
      const cikPromises = STORE_OPTIONS.map(async (s) => {
        try {
          const res = await fetch(`/api/customer-service?store=${s.id}`, { method: "POST" });
          const json = await res.json();
          if (json.status === "success") {
            return `CIK ${s.label}: ${json.records_inserted ?? 0} records`;
          }
          return `CIK ${s.label}: ${json.error || json.status}`;
        } catch {
          return `CIK ${s.label}: failed`;
        }
      });

      const cikResults = await Promise.all(cikPromises);
      results.push(...cikResults);

      // Now Grasshopper (all stores in one call)
      try {
        const ghRes = await fetch(`/api/customer-service?scraper=grasshopper`, { method: "POST" });
        const ghJson = await ghRes.json();
        if (ghJson.logs) setGhLogs(ghJson.logs);
        if (ghJson.diagnostics) setGhDiagnostics(ghJson.diagnostics);

        if (ghJson.status === "2fa_required") {
          setGh2faNeeded(true);
          setGhStatus("Verification code needed — check your email");
          results.push("Grasshopper: 2FA required");
        } else if (ghJson.status === "success" || ghJson.status === "partial_error") {
          results.push(`Grasshopper: ${ghJson.records_inserted ?? 0} records`);
          if (ghJson.status === "partial_error") {
            const errors = (ghJson.stores ?? []).filter((s: { status: string }) => s.status === "error");
            if (errors.length > 0) {
              setGhError(errors.map((s: { store_id: string; error: string }) => `${s.store_id}: ${s.error}`).join("\n"));
            }
          }
        } else {
          results.push(`Grasshopper: ${ghJson.error || "failed"}`);
          if (ghJson.error) setGhError(ghJson.error);
        }
      } catch {
        results.push("Grasshopper: failed to reach scraper");
      }

      // Importing call records and matching them to leads are separate steps.
      // Do both before reporting completion so "Called" status is current as
      // soon as a manual Sync All finishes.
      try {
        const leadSyncRes = await fetch("/api/customer-service?action=sync-lead-calls", {
          method: "POST",
        });
        const leadSyncJson = await leadSyncRes.json();
        if (!leadSyncRes.ok) {
          results.push(`Lead matching: ${leadSyncJson.error || "failed"}`);
        } else {
          const summary = leadSyncJson.lead_call_sync;
          results.push(
            `Lead matching: ${summary.statusesUpdated ?? 0} statuses updated`,
          );
        }
      } catch {
        results.push("Lead matching: failed to reach RF Tools");
      }

      setSyncAllStatus(`Done — ${results.join(" · ")}`);
      setSyncKey((k) => k + 1);
      await Promise.all([loadSummary(), loadHistory(), loadCallbacks(), loadPatterns()]);
    } finally {
      clearInterval(timer);
      setSyncAllRunning(false);
    }
  };

  // Empty state
  if (!loading && !data?.current?.total_calls && !error) {
    return (
      <div className="mt-6 bg-white rounded-xl border border-sand-200/60 p-10 text-center">
        <p className="text-sand-500 text-sm mb-2">
          No call data available yet.
        </p>
        {data?.lastScrape ? (
          <p className="text-sand-400 text-xs mb-4">
            Last scrape: {data.lastScrape.status}{" "}
            {data.lastScrape.finishedAt &&
              `at ${formatDateTime(data.lastScrape.finishedAt)}`}
            {data.lastScrape.errorMessage && (
              <span className="block text-red-500 mt-1">
                {data.lastScrape.errorMessage}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sand-400 text-xs mb-4">
            The QCWS scraper hasn&apos;t run yet.
          </p>
        )}
        <button
          onClick={handleSyncAll}
          disabled={syncAllRunning}
          className="px-4 py-2 text-sm bg-sand-900 text-sand-50 rounded-lg hover:bg-sand-800 disabled:opacity-50 transition-colors"
        >
          {syncAllRunning ? "Syncing..." : "Sync All Data"}
        </button>
        {syncAllRunning && <SyncInProgress label="Syncing All (CIK + Grasshopper)" elapsed={syncAllElapsed} color="sand" />}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Customer service</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Phones</h1>
          {(data?.lastSync?.cik || data?.lastSync?.grasshopper) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
              {data.lastSync.cik && <span title={data.lastSync.cik}>CIK updated {formatSyncTime(data.lastSync.cik)}</span>}
              {data.lastSync.grasshopper && <span title={data.lastSync.grasshopper}>Grasshopper updated {formatSyncTime(data.lastSync.grasshopper)}</span>}
            </div>
          )}
        </div>

        {mounted && (
          <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Phone dashboard view">
            {(["staff", "admin"] as Mode[]).map((viewMode) => (
              <button
                key={viewMode}
                type="button"
                onClick={() => handleModeChange(viewMode)}
                className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                  mode === viewMode
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {viewMode === "staff" ? "Team view" : "Admin tools"}
              </button>
            ))}
          </div>
        )}
      </header>

      <section className="border-y border-slate-200 py-4" aria-label="Phone dashboard filters">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Store</span>
              <select
                value={store}
                onChange={(e) => { setStore(e.target.value); localStorage.setItem("cs_store", e.target.value); }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              >
                {STORE_OPTIONS.map((storeOption) => (
                  <option key={storeOption.id} value={storeOption.id}>{storeOption.label}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Period</span>
              <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Reporting period">
                {[...RANGE_OPTIONS, { value: "custom" as const, label: "Custom", days: 0 }].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRange(option.value)}
                    className={`min-h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition-colors ${
                      range === option.value
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {range === "custom" && (
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">From</span>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">To</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
              </div>
            )}

            {mounted && mode === "admin" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Source</span>
                <select value={source} onChange={(e) => setSource(e.target.value as Source)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                  {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            )}
          </div>

          {mounted && mode === "admin" && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => window.print()} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 print:hidden" title="Save as PDF from the print dialog">Download report</button>
              <button type="button" onClick={handleSyncAll} disabled={syncAllRunning || ghScraping} className="h-9 rounded-lg bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                {syncAllRunning ? "Syncing..." : "Sync all"}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSchedule(!showSchedule)}
                  className={`h-9 rounded-lg border px-3 text-xs font-semibold transition ${syncSchedule?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                  title="Auto-sync schedule"
                >
                  {syncSchedule?.enabled ? `Auto: ${syncSchedule.hours.map((h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`).join(", ")}` : "Auto: Off"}
                </button>
                {showSchedule && syncSchedule && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">Auto-sync schedule</p>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input type="checkbox" checked={syncSchedule.enabled} onChange={() => saveSyncSchedule({ ...syncSchedule, enabled: !syncSchedule.enabled })} className="rounded border-slate-300" />
                        <span className="text-xs text-slate-600">{syncSchedule.enabled ? "On" : "Off"}</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {Array.from({ length: 24 }, (_, hour) => (
                        <button key={hour} type="button" onClick={() => toggleScheduleHour(hour)} className={`rounded px-1 py-1 text-[10px] transition-colors ${syncSchedule.hours.includes(hour) ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
                          {hour % 12 || 12}{hour < 12 ? "a" : "p"}
                        </button>
                      ))}
                    </div>
                    <button type="button" onClick={() => setShowSchedule(false)} className="mt-3 w-full text-xs font-medium text-slate-500 hover:text-slate-700">Done</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Sync progress & status (admin only) */}
      {mounted && mode === "admin" && syncAllRunning && <SyncInProgress label="Syncing All (CIK + Grasshopper)" elapsed={syncAllElapsed} color="sand" />}
      {mounted && mode === "admin" && !syncAllRunning && syncAllStatus && (
        <div className={`rounded-xl border p-4 text-sm ${
          syncAllStatus.startsWith("Done") ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`font-semibold ${syncAllStatus.startsWith("Done") ? "text-emerald-700" : "text-red-700"}`}>
                {syncAllStatus.startsWith("Done") ? "Sync Complete" : "Sync Failed"}
              </p>
              <p className={`text-xs mt-0.5 ${syncAllStatus.startsWith("Done") ? "text-emerald-600" : "text-red-500"}`}>
                {syncAllStatus}
              </p>
            </div>
            <button
              onClick={() => setSyncAllStatus("")}
              className="text-xs text-sand-400 hover:text-sand-600 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Grasshopper progress (admin only) */}
      {mounted && mode === "admin" && ghScraping && (
        <SyncInProgress label="Syncing Grasshopper" elapsed={ghElapsed} color="emerald" />
      )}

      {/* Grasshopper 2FA prompt (admin only) */}
      {mounted && mode === "admin" && gh2faNeeded && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <p className="text-sm text-emerald-800 font-medium">
            Grasshopper requires email verification
          </p>
          <p className="text-xs text-emerald-600">
            Check your email for a verification code, then enter it below.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gh2faCode}
              onChange={(e) => setGh2faCode(e.target.value)}
              placeholder="Enter code"
              className="px-3 py-1.5 text-sm border border-emerald-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-40"
              onKeyDown={(e) => {
                if (e.key === "Enter" && gh2faCode.trim()) handleGhScrape(gh2faCode.trim());
              }}
            />
            <button
              onClick={() => handleGhScrape(gh2faCode.trim())}
              disabled={!gh2faCode.trim() || ghScraping}
              className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {ghScraping ? "Verifying..." : "Submit"}
            </button>
            <button
              onClick={() => { setGh2faNeeded(false); setGhStatus(""); setGh2faCode(""); setGhError(""); setGhLogs([]); }}
              className="px-3 py-1.5 text-sm text-sand-500 hover:text-sand-700 transition-colors"
            >
              Cancel
            </button>
          </div>
          {ghLogs.length > 0 && (
            <div className="mt-2 bg-emerald-100/50 rounded-lg p-3 max-h-40 overflow-y-auto">
              <SyncLogDisplay logs={ghLogs} color="emerald" />
            </div>
          )}
        </div>
      )}

      {/* Grasshopper sync result (admin only) */}
      {mounted && mode === "admin" && !ghScraping && ghStatus && !gh2faNeeded && (
        <div className={`rounded-xl border p-4 text-sm ${
          ghError
            ? "bg-red-50 border-red-200"
            : ghStatus.startsWith("Done")
              ? "bg-emerald-50 border-emerald-200"
              : ghStatus.startsWith("Failed") || ghStatus.startsWith("Scrape failed")
                ? "bg-red-50 border-red-200"
                : "bg-sand-50 border-sand-200"
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`font-semibold ${
                ghError || ghStatus.startsWith("Failed") || ghStatus.startsWith("Scrape failed")
                  ? "text-red-700"
                  : ghStatus.startsWith("Done")
                    ? "text-emerald-700"
                    : "text-sand-700"
              }`}>
                {ghStatus.startsWith("Done") ? "Grasshopper Sync Complete" : ghStatus.startsWith("Failed") || ghStatus.startsWith("Scrape failed") ? "Grasshopper Sync Failed" : "Grasshopper Sync"}
              </p>
              <p className={`text-xs mt-0.5 ${
                ghError ? "text-red-500" : ghStatus.startsWith("Done") ? "text-emerald-600" : "text-sand-500"
              }`}>
                {ghStatus}
              </p>
            </div>
            <div className="text-right">
              {ghElapsed > 0 && (
                <span className="text-xs text-sand-400">
                  {ghElapsed < 60 ? `${ghElapsed}s` : `${Math.floor(ghElapsed / 60)}m ${ghElapsed % 60}s`}
                </span>
              )}
              <button
                onClick={() => { setGhStatus(""); setGhError(""); setGhLogs([]); setGhDiagnostics(null); setGhElapsed(0); }}
                className="ml-3 text-xs text-sand-400 hover:text-sand-600 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          {ghError && (
            <pre className="mt-2 text-xs bg-red-100/50 rounded-lg p-2 whitespace-pre-wrap font-mono text-red-700">{ghError}</pre>
          )}
          {ghDiagnostics && (
            <div className="mt-3 bg-black/5 rounded-lg p-3 text-xs space-y-1.5">
              <p className="font-semibold text-sand-700 text-[11px] uppercase tracking-wider">Report Diagnostics</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <span className="text-sand-400">CSV size:</span>{" "}
                  <span className="text-sand-700">{ghDiagnostics.csv_lines} lines, {(ghDiagnostics.csv_bytes / 1024).toFixed(0)} KB</span>
                </div>
                <div>
                  <span className="text-sand-400">Data rows:</span>{" "}
                  <span className="text-sand-700">{ghDiagnostics.csv_data_rows}</span>
                </div>
                <div>
                  <span className="text-sand-400">Parsed:</span>{" "}
                  <span className="text-sand-700">{ghDiagnostics.total_parsed}</span>
                </div>
                <div>
                  <span className="text-sand-400">Skipped:</span>{" "}
                  <span className={ghDiagnostics.total_skipped > 0 ? "text-amber-600 font-medium" : "text-sand-700"}>
                    {ghDiagnostics.total_skipped}
                  </span>
                </div>
              </div>
              {ghDiagnostics.csv_date_range && (
                <div>
                  <span className="text-sand-400">CSV date range:</span>{" "}
                  <span className="text-sand-700 font-medium">
                    {ghDiagnostics.csv_date_range.earliest} → {ghDiagnostics.csv_date_range.latest}
                  </span>
                </div>
              )}
              {ghDiagnostics.per_store && Object.keys(ghDiagnostics.per_store).length > 0 && (
                <div className="space-y-0.5">
                  {Object.entries(ghDiagnostics.per_store).map(([storeId, info]) => (
                    <div key={storeId}>
                      <span className="text-sand-400">{storeId}:</span>{" "}
                      <span className="text-sand-700">
                        {info.count} records, {info.earliest} → <span className="font-medium">{info.latest}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {ghLogs.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs cursor-pointer text-sand-400 hover:text-sand-600">
                Scraper log ({ghLogs.length} lines)
              </summary>
              <div className="mt-1 bg-black/5 rounded-lg p-3 max-h-60 overflow-y-auto">
                <SyncLogDisplay logs={ghLogs} color="emerald" />
              </div>
            </details>
          )}
        </div>
      )}

      {/* Last scrape error (admin only) */}
      {mounted && mode === "admin" && data?.lastScrape?.status === "error" && (
        <p className="text-[11px] text-red-500">
          Last CIK scrape error: {data.lastScrape.errorMessage}
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-sand-300 border-t-sand-600 rounded-full animate-spin" />
        </div>
      ) : mode === "staff" ? (
        <StaffView
          data={data}
          callbackData={callbackData}
          store={store}
          source={source}
          from={from}
          to={to}
          loadCallbacks={loadCallbacks}
          setSelectedNumber={setSelectedNumber}
          syncKey={syncKey}
        />
      ) : (
        <OverviewTab data={data} history={history} hourly={hourly} daily={daily} />
      )}

      {/* Customer lookup slide-over */}
      {selectedNumber && (
        <CustomerLookupPanel
          number={selectedNumber}
          store={store}
          source={source}
          onClose={() => setSelectedNumber(null)}
        />
      )}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-sand-300 hover:text-sand-500 transition-colors focus:outline-none"
        aria-label="More info"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <span className="absolute z-50 left-1/2 -translate-x-1/2 top-6 w-56 bg-sand-900 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg normal-case tracking-normal font-normal">
          {text}
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-sand-900 rotate-45" />
        </span>
      )}
    </span>
  );
}

function InsightsPanel({ metrics, daily }: { metrics: Metrics; daily?: DailyPoint[] }) {
  const insights: { text: string; type: "positive" | "improvement" }[] = [];

  // Calculate callback rate for insights
  const callbackRate = metrics.inbound_calls > 0
    ? Math.round((metrics.callbacks_needed / metrics.inbound_calls) * 1000) / 10
    : 0;

  // Positive insights first
  if (metrics.miss_rate <= 10) {
    insights.push({ text: `Your miss rate of ${metrics.miss_rate}% is excellent — well below the industry average of 10-20%.`, type: "positive" });
  } else if (metrics.miss_rate <= 20) {
    insights.push({ text: `Your miss rate of ${metrics.miss_rate}% is within industry standards — solid performance.`, type: "positive" });
  }

  if (metrics.avg_duration >= 3 && metrics.avg_duration <= 6) {
    insights.push({ text: `Average call duration of ${metrics.avg_duration} min is healthy — calls are thorough without being too long.`, type: "positive" });
  }

  if (callbackRate <= 5) {
    insights.push({ text: `Callback rate of ${callbackRate}% is very low — most customers are getting through on the first try.`, type: "positive" });
  }

  if (metrics.recovery_rate >= 80) {
    insights.push({ text: `Recovery rate of ${metrics.recovery_rate}% is excellent — you're calling back most unanswered callers.`, type: "positive" });
  } else if (metrics.recovery_rate >= 60) {
    insights.push({ text: `Recovery rate of ${metrics.recovery_rate}% is solid — most unanswered callers are getting a callback.`, type: "positive" });
  }

  if (metrics.avg_response_time != null && metrics.avg_response_time > 0 && metrics.avg_response_time <= 15) {
    insights.push({ text: `Average callback response time of ${metrics.avg_response_time} min is fast — customers aren't waiting long for a return call.`, type: "positive" });
  }

  if (metrics.outbound_calls > 0 && metrics.inbound_calls > 0) {
    const outboundRatio = Math.round((metrics.outbound_calls / metrics.inbound_calls) * 100);
    if (outboundRatio >= 20) {
      insights.push({ text: `Your team is proactively making outbound calls (${outboundRatio}% of inbound volume) — great for follow-ups.`, type: "positive" });
    }
  }

  // If no positive insights, add a generic one
  if (insights.filter(i => i.type === "positive").length === 0) {
    insights.push({ text: `You're handling ${metrics.total_calls} calls this period — keep up the consistent effort.`, type: "positive" });
  }

  // Improvement suggestions
  if (metrics.miss_rate > 20) {
    insights.push({ text: `Miss rate of ${metrics.miss_rate}% is above average. Consider staggering breaks so the phone is always covered, or setting up call forwarding during peak hours.`, type: "improvement" });
  } else if (metrics.miss_rate > 10) {
    insights.push({ text: `To bring miss rate below 10%, try answering within 3 rings and ensure coverage during lunch hours.`, type: "improvement" });
  }

  if (metrics.recovery_rate < 60) {
    insights.push({ text: `Recovery rate of ${metrics.recovery_rate}% is below average. Aim to call back every unanswered caller within the same business day.`, type: "improvement" });
  }

  if (metrics.avg_response_time != null && metrics.avg_response_time > 60) {
    insights.push({ text: `Average callback time of ${metrics.avg_response_time} min is over an hour. Try to return unanswered calls within 30 minutes during business hours.`, type: "improvement" });
  }

  if (metrics.avg_duration > 6) {
    insights.push({ text: `Average handle time of ${metrics.avg_duration} min is above the 4-6 min benchmark. Consider preparing FAQ scripts for common questions to speed up calls.`, type: "improvement" });
  }

  if (callbackRate > 15) {
    insights.push({ text: `Callback rate of ${callbackRate}% is high. Prioritize answering inbound calls over other tasks to reduce the need for callbacks.`, type: "improvement" });
  } else if (callbackRate > 5) {
    insights.push({ text: `Callback rate of ${callbackRate}% could be improved. Try to return unanswered calls within 30 minutes during business hours.`, type: "improvement" });
  }

  // Weekend coverage alerts
  if (daily && daily.length > 0) {
    // daily is ordered Mon-Sun after reorder; find Sat (index 5) and Sun (index 6)
    const sat = daily.find((d) => d.label === "Sat");
    const sun = daily.find((d) => d.label === "Sun");
    if (sat && sat.total_calls > 0 && sat.miss_rate > 30) {
      insights.push({ text: `Saturday miss rate is ${sat.miss_rate}%. Consider setting up voicemail greetings or auto-text replies for weekend calls.`, type: "improvement" });
    }
    if (sun && sun.total_calls > 0 && sun.miss_rate > 30) {
      insights.push({ text: `Sunday miss rate is ${sun.miss_rate}%. If you don't operate on Sundays, set up an after-hours message so callers know when to call back.`, type: "improvement" });
    }
    if (sat && sun && sat.miss_rate <= 15 && sun.miss_rate <= 15 && (sat.total_calls + sun.total_calls) > 0) {
      insights.push({ text: `Weekend coverage is strong — Saturday ${sat.miss_rate}% and Sunday ${sun.miss_rate}% missed.`, type: "positive" });
    }
  }

  if (insights.length === 0) return null;
  const prioritizedInsights = [
    ...insights.filter((insight) => insight.type === "improvement"),
    ...insights.filter((insight) => insight.type === "positive"),
  ].slice(0, 5);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="management-focus-heading">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="management-focus-heading" className="text-sm font-semibold text-slate-900">Management focus</h2>
          <p className="mt-0.5 text-xs text-slate-400">Prioritized actions and positive signals from this period.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Top {prioritizedInsights.length}</span>
      </div>
      <div className="space-y-3">
        {prioritizedInsights.map((insight, index) => (
          <div key={index} className="flex gap-2.5 rounded-lg bg-slate-50/70 p-3">
            <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              insight.type === "positive"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}>
              {insight.type === "positive" ? "\u2713" : "!"}
            </span>
            <p className="text-[12px] leading-relaxed text-slate-600">{insight.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SyncInProgress({
  label,
  elapsed,
  color = "sand",
}: {
  label: string;
  elapsed: number;
  color?: "sand" | "emerald";
}) {
  const c = color === "emerald"
    ? { bg: "bg-emerald-50", border: "border-emerald-200/60", text: "text-emerald-700", dim: "text-emerald-400", spinner: "border-emerald-300 border-t-emerald-600", bar: "bg-emerald-200", barFill: "bg-emerald-500" }
    : { bg: "bg-sand-50", border: "border-sand-200/60", text: "text-sand-700", dim: "text-sand-400", spinner: "border-sand-300 border-t-sand-600", bar: "bg-sand-200", barFill: "bg-sand-600" };

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-4 h-4 border-2 rounded-full animate-spin ${c.spinner}`} />
          <p className={`text-sm font-semibold ${c.text}`}>{label}</p>
        </div>
        <span className={`text-xs tabular-nums ${c.dim}`}>
          {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
        </span>
      </div>
      <p className={`text-[11px] ${c.dim}`}>
        Logs will appear when the sync completes. This typically takes 1-3 minutes.
      </p>
    </div>
  );
}

function SyncLogDisplay({ logs, color = "sand" }: { logs: string[]; color?: "sand" | "emerald" }) {
  if (logs.length === 0) return null;

  const c = color === "emerald"
    ? { check: "text-emerald-500", error: "text-red-500", dim: "text-emerald-400" }
    : { check: "text-sand-500", error: "text-red-500", dim: "text-sand-400" };

  return (
    <div className="mt-3 space-y-0.5">
      {logs.map((line, i) => {
        const isError = /error|fail|warning/i.test(line);
        const isStep = line.trim().startsWith("[") || /navigat|login|click|filled|download|report|upsert|success|generat|loaded|verified/i.test(line);
        return (
          <div key={i} className="flex items-start gap-2 text-[11px] font-mono leading-relaxed">
            <span className={`flex-shrink-0 mt-0.5 ${isError ? c.error : isStep ? c.check : c.dim}`}>
              {isError ? "!" : isStep ? ">" : " "}
            </span>
            <span className={isError ? "text-red-600" : "text-sand-600"}>
              {line}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BenchmarkPanel({ metrics, previous }: { metrics: Metrics; previous?: Metrics }) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="benchmark-position-heading">
      <div>
        <h2 id="benchmark-position-heading" className="text-sm font-semibold text-slate-900">Benchmark position</h2>
        <p className="mt-0.5 text-xs text-slate-400">How current service performance compares with common industry ranges.</p>
      </div>
      {BENCHMARKS.map((b) => {
        const value = b.getValue(metrics);
        const prevValue = previous ? b.getValue(previous) : null;
        const level = getBenchmarkLevel(value, b.low, b.high, b.invert);
        const insight = getBenchmarkInsight(b.label, value, b.low, b.high, b.industry, b.invert);
        const maxVal = b.high * 3;
        const barWidth = Math.min((value / maxVal) * 100, 100);
        const lowMark = (b.low / maxVal) * 100;
        const highMark = (b.high / maxVal) * 100;

        return (
          <div key={b.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-sand-700 flex items-center gap-1">
                {b.label}
                <InfoTip text={b.tooltip} />
              </span>
              <span className={`text-xs font-semibold ${level.color} flex items-center gap-1`}>
                {value}{b.unit}
                {prevValue !== null && prevValue !== 0 && (() => {
                  const diff = value - prevValue;
                  if (Math.abs(diff) < 0.1) return null;
                  // For inverted metrics (higher=better), increase is good
                  const isImproving = b.invert ? diff > 0 : diff < 0;
                  return (
                    <span className={`text-[10px] ${isImproving ? "text-green-600" : "text-red-500"}`}>
                      {diff > 0 ? "\u25B2" : "\u25BC"}
                    </span>
                  );
                })()}
              </span>
            </div>
            {/* Gauge bar */}
            <div className="relative h-2 bg-sand-100 rounded-full overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all ${level.bg}`}
                style={{ width: `${barWidth}%`, opacity: 0.7 }}
              />
              {/* Industry range markers */}
              <div
                className="absolute top-0 bottom-0 w-px bg-sand-400"
                style={{ left: `${lowMark}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-px bg-sand-400"
                style={{ left: `${highMark}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-sand-300">0</span>
              <span className="text-[10px] text-sand-400">Industry: {b.industry}</span>
            </div>
            <p className="text-[11px] text-sand-500 leading-snug">{insight}</p>
          </div>
        );
      })}
    </section>
  );
}

function StaffView({
  data,
  callbackData,
  store,
  source,
  from,
  to,
  loadCallbacks,
  setSelectedNumber,
  syncKey,
}: {
  data: SummaryResponse | null;
  callbackData: CallbacksResponse | null;
  store: string;
  source: Source;
  from: string;
  to: string;
  loadCallbacks: () => Promise<void>;
  setSelectedNumber: (n: string | null) => void;
  syncKey: number;
}) {
  const metrics = data?.current;
  const change = data?.change;

  const MISS_RATE_TARGET = 15;
  const CALLBACK_RATE_TARGET = 90;

  const missRate = metrics?.miss_rate ?? 0;
  const missedCount = metrics?.missed_calls ?? 0;
  const pendingCallbacks = (callbackData?.callbacks ?? []).filter((c) => c.note_status !== "done").length;
  const manuallyResolvedCalls = (callbackData?.callbacks ?? [])
    .filter((callback) => callback.note_status === "done")
    .reduce((total, callback) => total + callback.calls.length, 0);
  const callbackCompletion = calculateCallbackCompletion(
    missedCount,
    metrics?.recovery_rate ?? 0,
    manuallyResolvedCalls,
  );
  const callbackRate = callbackCompletion.rate;
  const previousCallbackRate = data?.previous?.missed_calls
    ? data.previous.recovery_rate
    : 100;
  const callbackRateChange = previousCallbackRate > 0
    ? Math.round(((callbackRate - previousCallbackRate) / previousCallbackRate) * 100)
    : null;

  const missOnTrack = missRate <= MISS_RATE_TARGET;
  const callbackOnTrack = callbackRate >= CALLBACK_RATE_TARGET;
  const inboundCount = metrics?.inbound_calls ?? 0;

  const staffCards: { label: string; value: number; prev: number; change: number | null | undefined; format: (n: number) => string; target?: number; invert?: boolean; higherIsBetter?: boolean; tooltip?: string; subtitle?: string }[] = [
    { label: "Inbound", value: inboundCount, prev: data?.previous?.inbound_calls ?? 0, change: change?.inbound_calls, format: formatNumber },
    { label: "Outbound", value: metrics?.outbound_calls ?? 0, prev: data?.previous?.outbound_calls ?? 0, change: change?.outbound_calls, format: formatNumber },
    { label: "Miss Rate", value: missRate, prev: data?.previous?.miss_rate ?? 0, change: change?.miss_rate, format: (n: number) => `${n}%`, target: MISS_RATE_TARGET, invert: true, tooltip: "Unanswered calls (no pickup + voicemail) \u00f7 total inbound \u00d7 100.", subtitle: `${missedCount} unanswered out of ${inboundCount} inbound` },
    { label: "Callback Rate", value: callbackRate, prev: previousCallbackRate, change: callbackRateChange, format: (n: number) => `${n}%`, target: CALLBACK_RATE_TARGET, higherIsBetter: true, tooltip: "Unanswered calls resolved by an outbound callback, an answered return call, or a completed callback note \u00f7 total unanswered calls \u00d7 100.", subtitle: `${callbackCompletion.resolved} resolved out of ${missedCount} unanswered` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.35fr)]">
        <section className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[410px]" aria-labelledby="staff-analysis-heading">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5">
            <div>
              <h2 id="staff-analysis-heading" className="text-sm font-semibold text-slate-900">Analysis</h2>
              <p className="mt-0.5 text-xs text-slate-400">A quick read on call activity and follow-up.</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              missOnTrack && callbackOnTrack
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}>
              {missOnTrack && callbackOnTrack ? "On target" : "Needs attention"}
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              {staffCards.slice(0, 2).map((card) => (
                <div key={card.label} className="rounded-lg bg-slate-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{card.label}</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <p className="text-2xl font-semibold tracking-tight text-slate-950">{card.format(card.value)}</p>
                    <ChangeBadge value={card.change ?? null} invert={card.invert} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">Previous: {card.format(card.prev)}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              {staffCards.slice(2).map((card, index) => {
                const onTrack = card.higherIsBetter
                  ? card.value >= (card.target ?? 0)
                  : card.value <= (card.target ?? 0);
                return (
                  <div key={card.label} className={`relative px-3.5 py-3 ${index > 0 ? "border-t border-slate-100" : ""}`}>
                    <span className={`absolute inset-y-0 left-0 w-0.5 ${onTrack ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{card.label}</p>
                          {card.tooltip && <InfoTip text={card.tooltip} />}
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-2">
                          <p className="text-xl font-semibold tracking-tight text-slate-950">{card.format(card.value)}</p>
                          <ChangeBadge value={card.change ?? null} invert={card.invert} />
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${onTrack ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {onTrack ? "On target" : `Target ${card.higherIsBetter ? "≥" : "≤"}${card.target}%`}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{card.subtitle}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs">
            <span className="font-semibold text-slate-700">{formatMinutesLong(metrics?.total_minutes ?? 0)} on the phone</span>
            <span className="text-slate-400">
              {formatNumber(metrics?.inbound_minutes ?? 0)} inbound min &middot; {formatNumber(metrics?.outbound_minutes ?? 0)} outbound min
            </span>
          </div>
        </section>

        <StaffCallbacksPanel
          data={callbackData}
          store={store}
          loadCallbacks={loadCallbacks}
          setSelectedNumber={setSelectedNumber}
        />
      </div>

      <section aria-labelledby="staff-call-log-heading">
        <div className="mb-2 flex items-end justify-between gap-4">
          <div>
            <h2 id="staff-call-log-heading" className="text-sm font-semibold text-slate-900">Call log</h2>
            <p className="mt-0.5 text-xs text-slate-400">Search and review every call in the selected period.</p>
          </div>
          {pendingCallbacks > 0 && (
            <span className="text-xs font-medium text-amber-700">
              {pendingCallbacks} callback{pendingCallbacks === 1 ? "" : "s"} pending
            </span>
          )}
        </div>
        <CallLogTab
          store={store}
          source={source}
          from={from}
          to={to}
          onNumberClick={setSelectedNumber}
          syncKey={syncKey}
        />
      </section>
    </div>
  );
}

function StaffCallbacksPanel({
  data,
  store,
  loadCallbacks,
  setSelectedNumber,
}: {
  data: CallbacksResponse | null;
  store: string;
  loadCallbacks: () => Promise<void>;
  setSelectedNumber: (n: string | null) => void;
}) {
  const [expandedNumber, setExpandedNumber] = useState<string | null>(null);
  const callbacks = useMemo(() => {
    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...(data?.callbacks ?? [])]
      .filter((callback) => callback.note_status !== "done")
      .sort((a, b) => {
        const priorityDifference = (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3);
        return priorityDifference || new Date(b.last_call).getTime() - new Date(a.last_call).getTime();
      });
  }, [data?.callbacks]);
  const highPriorityCount = callbacks.filter((callback) => callback.priority === "high").length;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[410px]" aria-labelledby="staff-callbacks-heading">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="staff-callbacks-heading" className="text-sm font-semibold text-slate-900">Needs callback</h2>
            {callbacks.length > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{callbacks.length}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">Call the highest priority customers first.</p>
        </div>
        {highPriorityCount > 0 && (
          <span className="shrink-0 text-[11px] font-semibold text-red-600">{highPriorityCount} high priority</span>
        )}
      </div>

      {callbacks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-lg text-emerald-600">&#10003;</span>
          <p className="mt-2 text-sm font-semibold text-slate-800">Everyone has been called back</p>
          <p className="mt-1 text-xs text-slate-400">There are no pending callbacks for this period.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {callbacks.map((callback) => (
            <StaffCallbackItem
              key={callback.from_number}
              callback={callback}
              store={store}
              expanded={expandedNumber === callback.from_number}
              onToggle={() => setExpandedNumber((current) => current === callback.from_number ? null : callback.from_number)}
              loadCallbacks={loadCallbacks}
              setSelectedNumber={setSelectedNumber}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StaffCallbackItem({
  callback,
  store,
  expanded,
  onToggle,
  loadCallbacks,
  setSelectedNumber,
}: {
  callback: CallbackGroup;
  store: string;
  expanded: boolean;
  onToggle: () => void;
  loadCallbacks: () => Promise<void>;
  setSelectedNumber: (n: string | null) => void;
}) {
  const [note, setNote] = useState(callback.note ?? "");
  const [saving, setSaving] = useState(false);

  const saveNote = async (status: "pending" | "done") => {
    setSaving(true);
    try {
      await fetch("/api/customer-service?view=note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: store,
          from_number: callback.from_number,
          note,
          status,
        }),
      });
      await loadCallbacks();
    } finally {
      setSaving(false);
    }
  };

  const priorityStyle = callback.priority === "high"
    ? "bg-red-500"
    : callback.priority === "medium"
      ? "bg-amber-400"
      : "bg-slate-300";

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${priorityStyle}`} aria-label={`${callback.priority} priority`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <PhoneLink number={callback.from_number} onClick={() => setSelectedNumber(callback.from_number)} />
            {callback.is_first_time && (
              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">New</span>
            )}
            {callback.attempts > 1 && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{callback.attempts} attempts</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            Last call {timeAgo(callback.last_call)}{callback.note ? ` · ${callback.note}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          aria-expanded={expanded}
        >
          {expanded ? "Close" : "Note"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a callback note"
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => saveNote("pending")} disabled={saving} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
              Save note
            </button>
            <button type="button" onClick={() => saveNote("done")} disabled={saving} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "Saving..." : "Mark done"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({
  data,
  history,
  hourly,
  daily,
}: {
  data: SummaryResponse | null;
  history: HistoryPoint[];
  hourly: HourlyPoint[];
  daily: DailyPoint[];
}) {
  if (!data) return null;

  const metrics = data.current;
  const maxDaily = Math.max(...daily.map((d) => d.total_calls), 1);
  const missOnTrack = metrics.miss_rate <= 15;
  const callbackOnTrack = metrics.outbound_callback_rate >= 90;
  const responseOnTrack = metrics.avg_response_time != null && metrics.avg_response_time <= 60;

  const operationalDetails = [
    {
      label: "Phone time",
      value: formatMinutesLong(metrics.total_minutes),
      detail: `${formatNumber(metrics.total_minutes)} minutes`,
    },
    {
      label: "Avg inbound",
      value: `${metrics.avg_duration_inbound} min`,
      detail: "Answered calls",
    },
    {
      label: "Avg outbound",
      value: `${metrics.avg_duration_outbound} min`,
      detail: "Outbound calls",
    },
    {
      label: "Voicemails",
      value: formatNumber(metrics.vm_calls),
      detail: "Received this period",
    },
    {
      label: "New callers",
      value: formatNumber(metrics.first_time_callers),
      detail: "First-time numbers",
    },
    {
      label: "Returning",
      value: formatNumber(metrics.returning_callers),
      detail: "Repeat callers",
    },
  ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="admin-snapshot-heading">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="admin-snapshot-heading" className="text-sm font-semibold text-slate-950">Performance snapshot</h2>
            <p className="mt-0.5 text-xs text-slate-400">The service-level measures that need an administrator&apos;s attention first.</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold">
            <span className={`rounded-full px-2.5 py-1 ${missOnTrack ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              Miss rate {missOnTrack ? "on target" : "above target"}
            </span>
            <span className={`rounded-full px-2.5 py-1 ${callbackOnTrack ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              Callbacks {callbackOnTrack ? "on target" : "below target"}
            </span>
          </div>
        </div>

        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
          <AdminPrimaryMetric
            label="Total calls"
            value={formatNumber(metrics.total_calls)}
            detail={`${formatNumber(metrics.inbound_calls)} inbound · ${formatNumber(metrics.outbound_calls)} outbound`}
            previous={formatNumber(data.previous.total_calls)}
            change={data.change.total_calls}
            tone="blue"
          />
          <AdminPrimaryMetric
            label="Miss rate"
            value={`${metrics.miss_rate}%`}
            detail={`${formatNumber(metrics.missed_calls)} unanswered · target ≤15%`}
            previous={`${data.previous.miss_rate}%`}
            change={data.change.miss_rate}
            invert
            tone={missOnTrack ? "green" : "amber"}
          />
          <AdminPrimaryMetric
            label="Callback coverage"
            value={`${metrics.outbound_callback_rate}%`}
            detail={`${formatNumber(metrics.outbound_callbacks_made)} recovered · target ≥90%`}
            previous={`${data.previous.outbound_callback_rate}%`}
            change={data.change.outbound_callback_rate}
            tone={callbackOnTrack ? "green" : "amber"}
          />
          <AdminPrimaryMetric
            label="Avg callback time"
            value={formatResponseTime(metrics.avg_response_time ?? 0)}
            detail="Industry range 15 to 60 min"
            previous={formatResponseTime(data.previous.avg_response_time ?? 0)}
            change={data.change.avg_response_time}
            invert
            tone={metrics.avg_response_time == null ? "blue" : responseOnTrack ? "green" : "amber"}
          />
        </div>

        <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/70 md:grid-cols-3 xl:grid-cols-6">
          {operationalDetails.map((detail) => (
            <div key={detail.label} className="border-b border-r border-slate-100 px-4 py-3 last:border-r-0 md:border-b-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{detail.label}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{detail.value}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{detail.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        {history.length > 1 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="admin-volume-heading">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="admin-volume-heading" className="text-sm font-semibold text-slate-900">Call volume trend</h2>
                <p className="mt-0.5 text-xs text-slate-400">Inbound and outbound demand across the selected period.</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-slate-400">{formatNumber(metrics.total_calls)} total</span>
            </div>
            <div className="h-64">
              <CallVolumeChart history={history} />
            </div>
          </section>
        )}
        <InsightsPanel metrics={metrics} daily={daily} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {history.length > 1 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="admin-miss-trend-heading">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="admin-miss-trend-heading" className="text-sm font-semibold text-slate-900">Service level trend</h2>
                <p className="mt-0.5 text-xs text-slate-400">Daily miss rate with a 15% internal target.</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${missOnTrack ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {metrics.miss_rate}% current
              </span>
            </div>
            <div className="h-64">
              <MissRateChart history={history} />
            </div>
          </section>
        )}
        <BenchmarkPanel metrics={metrics} previous={data.previous} />
      </div>

      {(hourly.some((hour) => hour.total_calls > 0) || daily.some((day) => day.total_calls > 0)) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="admin-coverage-heading">
          <div className="mb-5">
            <h2 id="admin-coverage-heading" className="text-sm font-semibold text-slate-900">Coverage patterns</h2>
            <p className="mt-0.5 text-xs text-slate-400">Use demand by hour and weekday to plan staffing and breaks.</p>
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)]">
            {hourly.some((hour) => hour.total_calls > 0) && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Calls by hour</p>
                <div className="h-56">
                  <PeakHoursChart hourly={hourly} />
                </div>
              </div>
            )}
            {daily.some((day) => day.total_calls > 0) && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Weekday load</p>
                <div className="grid grid-cols-7 gap-2">
                  {daily.map((day) => {
                    const height = maxDaily > 0 ? Math.max((day.total_calls / maxDaily) * 100, 4) : 4;
                    const average = day.dayCount > 0 ? Math.round(day.total_calls / day.dayCount) : 0;
                    return (
                      <div key={day.label} className="text-center">
                        <div className="flex h-28 items-end overflow-hidden rounded-md bg-slate-50">
                          <div
                            className={`w-full rounded-t-sm ${day.miss_rate > 20 ? "bg-amber-300" : "bg-blue-300"}`}
                            style={{ height: `${height}%` }}
                          />
                        </div>
                        <p className="mt-2 text-[11px] font-semibold text-slate-700">{day.label}</p>
                        <p className="text-xs font-semibold text-slate-900">{average}</p>
                        <p className={`text-[9px] ${day.miss_rate > 20 ? "text-amber-600" : "text-slate-400"}`}>{day.miss_rate}% miss</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function AdminPrimaryMetric({
  label,
  value,
  detail,
  previous,
  change,
  invert,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  previous: string;
  change: number | null | undefined;
  invert?: boolean;
  tone: "blue" | "green" | "amber";
}) {
  const toneStyle = {
    blue: "bg-blue-500",
    green: "bg-emerald-500",
    amber: "bg-amber-400",
  }[tone];

  return (
    <div className="relative bg-white px-5 py-4">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${toneStyle}`} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        <ChangeBadge value={change ?? null} invert={invert} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
      <p className="mt-2 text-[10px] text-slate-400">Previous: {previous}</p>
    </div>
  );
}

function CallLogTab({
  store,
  source,
  from,
  to,
  onNumberClick,
  syncKey,
}: {
  store: string;
  source: Source;
  from: string;
  to: string;
  onNumberClick: (n: string) => void;
  syncKey?: number;
}) {
  const [records, setRecords] = useState<
    { id: string; call_start: string; from_number: string; to_number: string; direction: string; duration_min: number; endpoint: string | null; source: string; is_first_time?: boolean; call_count?: number }[]
  >([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");
  const [status, setStatus] = useState<"all" | "answered" | "missed" | "voicemail">("all");
  const [localSource, setLocalSource] = useState<Source>(source);
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [phone, setPhone] = useState("");
  const [extension, setExtension] = useState("");
  const [availableExtensions, setAvailableExtensions] = useState<string[]>([]);

  const hasFilters = direction !== "all" || status !== "all" || localSource !== source || minDuration !== "" || maxDuration !== "" || phone !== "" || extension !== "";

  const clearFilters = () => {
    setDirection("all");
    setStatus("all");
    setLocalSource(source);
    setMinDuration("");
    setMaxDuration("");
    setPhone("");
    setExtension("");
  };

  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (direction !== "all") params.set("direction", direction);
    if (status !== "all") params.set("status", status);
    if (minDuration) params.set("minDuration", minDuration);
    if (maxDuration) params.set("maxDuration", maxDuration);
    if (phone) params.set("phone", phone);
    if (extension) params.set("extension", extension);
    return params.toString();
  };

  useEffect(() => {
    setLocalSource(source);
  }, [source]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      view: "extensions",
      store,
      source: localSource,
      from,
      to,
    });

    fetch(`/api/customer-service?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { extensions: [] })
      .then((result) => {
        const extensions = Array.isArray(result.extensions) ? result.extensions : [];
        setAvailableExtensions(extensions);
        setExtension((current) => current && !extensions.includes(current) ? "" : current);
      })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") setAvailableExtensions([]);
      });

    return () => controller.abort();
  }, [store, localSource, from, to, syncKey]);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const filterStr = buildFilterParams();
      const res = await fetch(
        `/api/customer-service?view=call-log&store=${store}&source=${localSource}&from=${from}&to=${to}&page=${p}${filterStr ? `&${filterStr}` : ""}`
      );
      const data = await res.json();
      setRecords(data.records ?? []);
      setTotalPages(data.totalPages ?? 1);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, localSource, from, to, direction, status, minDuration, maxDuration, phone, extension, syncKey]);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  const [exporting, setExporting] = useState(false);

  const endpointInfo = (ep: string | null, direction: string) => {
    if (!ep && direction === "outbound") return { label: "Dialed", color: "text-sand-500", bg: "" };
    if (!ep) return { label: "Missed", color: "text-red-600", bg: "bg-red-50" };
    const epLower = ep.toLowerCase();
    if (epLower === "vm" || epLower.includes("vm")) return { label: "Voicemail", color: "text-amber-600", bg: "bg-amber-50" };
    if (epLower === "answered") return { label: "Answered", color: "text-green-600", bg: "bg-green-50" };
    if (/^\d{2,4}$/.test(ep)) return { label: `Ext. ${ep}`, color: "text-green-600", bg: "bg-green-50" };
    return { label: ep, color: "text-sand-500", bg: "" };
  };

  const endpointLabel = (ep: string | null) => {
    if (!ep) return "Missed";
    const epLower = ep.toLowerCase();
    if (epLower === "vm" || epLower.includes("vm")) return "Voicemail";
    if (epLower === "answered") return "Answered";
    if (/^\d{2,4}$/.test(ep)) return `Ext. ${ep}`;
    return ep;
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      // Fetch all pages
      const allRecords: typeof records = [];
      let p = 1;
      while (true) {
        const filterStr = buildFilterParams();
        const res = await fetch(
          `/api/customer-service?view=call-log&store=${store}&source=${localSource}&from=${from}&to=${to}&page=${p}${filterStr ? `&${filterStr}` : ""}`
        );
        const data = await res.json();
        allRecords.push(...(data.records ?? []));
        if (p >= (data.totalPages ?? 1)) break;
        p++;
      }
      const header = "Date/Time,Direction,From,To,Duration (min),Status,Source,New Caller\n";
      const rows = allRecords.map((r) =>
        [
          r.call_start,
          r.direction,
          r.from_number === "unknown" ? "Unknown" : formatPhoneNumber(r.from_number),
          r.to_number === "unknown" ? "Unknown" : formatPhoneNumber(r.to_number),
          r.duration_min,
          endpointLabel(r.endpoint),
          r.source === "grasshopper" ? "Grasshopper" : "CIK",
          r.is_first_time ? "Yes" : "",
        ].join(",")
      );
      const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `call-log-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-slate-200 bg-slate-50/60 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_160px_220px_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Phone number</span>
            <input
              type="search"
              placeholder="Search caller or destination"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Extension</span>
            <select
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            >
              <option value="">All extensions</option>
              {availableExtensions.map((value) => <option key={value} value={value}>Ext. {value}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Source</span>
            <select value={localSource} onChange={(e) => setLocalSource(e.target.value as Source)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
              {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Duration in minutes</legend>
            <div className="flex items-center gap-2">
              <input type="number" aria-label="Minimum duration" placeholder="Min" value={minDuration} onChange={(e) => setMinDuration(e.target.value)} className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" min="0" step="0.5" />
              <span className="text-slate-300">to</span>
              <input type="number" aria-label="Maximum duration" placeholder="Max" value={maxDuration} onChange={(e) => setMaxDuration(e.target.value)} className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" min="0" step="0.5" />
            </div>
          </fieldset>

          <div className="flex items-end">
            <button type="button" onClick={clearFilters} disabled={!hasFilters} className="h-9 rounded-lg px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40">Reset</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="Call direction">
            {(["all", "inbound", "outbound"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setDirection(value)} className={`min-h-7 rounded-md px-3 text-xs font-semibold transition-colors ${direction === value ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
                {value === "all" ? "All calls" : value.charAt(0).toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
              <option value="all">All statuses</option>
              <option value="answered">Answered</option>
              <option value="missed">Missed</option>
              <option value="voicemail">Voicemail</option>
            </select>
          </label>
        </div>
      </div>

      {/* Summary & pagination */}
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-sand-600">
          {total.toLocaleString()} calls
          {hasFilters && <span className="ml-1.5 px-1.5 py-0.5 bg-sand-100 text-sand-500 rounded text-[10px] font-medium">filtered</span>}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={exporting || loading}
            className="px-3 py-1.5 text-xs font-medium text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 disabled:opacity-50 transition-colors"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
          <button
            onClick={() => fetchPage(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 text-xs font-medium text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 disabled:opacity-30 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-sand-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => fetchPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 text-xs font-medium text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      <div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-sand-300 border-t-sand-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-260px)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-sand-100 text-left">
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Date/Time</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Direction</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">From</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">To</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Duration</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Status</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                      No calls match these filters.
                    </td>
                  </tr>
                ) : records.map((r) => (
                  <tr key={r.id} className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors">
                    <td className="px-4 py-2.5 text-sand-700 whitespace-nowrap">{formatDateTime(r.call_start)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        r.direction === "inbound" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"
                      }`}>
                        {r.direction === "inbound" ? "In" : "Out"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.from_number === "unknown" ? (
                        <span className="text-sand-400 text-xs">Unknown</span>
                      ) : (
                        <>
                          <PhoneLink number={r.from_number} onClick={() => onNumberClick(r.from_number)} />
                          {r.is_first_time && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
                              New
                            </span>
                          )}
                          {r.call_count && r.call_count >= 3 && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-medium">
                              {r.call_count}x
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.to_number === "unknown" ? (
                        <span className="text-sand-400 text-xs">Unknown</span>
                      ) : (
                        <PhoneLink number={r.to_number} onClick={() => onNumberClick(r.to_number)} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sand-600">{r.duration_min} min</td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const info = endpointInfo(r.endpoint, r.direction);
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${info.color} ${info.bg}`}>
                            {info.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.source === "grasshopper" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {r.source === "grasshopper" ? "GH" : "CIK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerLookupPanel({
  number,
  store,
  source,
  onClose,
}: {
  number: string;
  store: string;
  source: Source;
  onClose: () => void;
}) {
  const [calls, setCalls] = useState<
    { id: string; call_start: string; direction: string; duration_min: number; endpoint: string | null; source?: string }[]
  >([]);
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const queryKey = `${store}:${source}:${number}`;
  const loading = resolvedKey !== queryKey;

  useEffect(() => {
    fetch(`/api/customer-service?view=customer&store=${store}&source=${source}&number=${encodeURIComponent(number)}`)
      .then((r) => r.json())
      .then((data) => {
        setCalls(data.calls ?? []);
        setNote(data.note ?? "");
        setNoteStatus(data.note_status ?? "");
      })
      .finally(() => setResolvedKey(queryKey));
  }, [number, store, source, queryKey]);

  const digits = number.replace(/\D/g, "");
  const telHref = `tel:${digits.length === 10 ? "+1" + digits : "+" + digits}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl border-l border-sand-200 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-sand-100 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-sand-900">
              {formatPhoneNumber(number)}
            </p>
            <a
              href={telHref}
              className="text-xs text-sand-500 hover:text-sand-700 transition-colors"
            >
              Tap to call
            </a>
          </div>
          <div className="flex items-center gap-2">
            {noteStatus === "done" && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                Done
              </span>
            )}
            <button
              onClick={onClose}
              className="text-sand-400 hover:text-sand-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {note && (
            <div className="bg-sand-50 rounded-lg p-3">
              <p className="text-[11px] text-sand-400 uppercase tracking-wider mb-1">Note</p>
              <p className="text-xs text-sand-700">{note}</p>
            </div>
          )}

          <p className="text-[11px] text-sand-400 uppercase tracking-wider">
            Call History ({calls.length})
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-sand-300 border-t-sand-600 rounded-full animate-spin" />
            </div>
          ) : calls.length === 0 ? (
            <p className="text-xs text-sand-400 py-4 text-center">No calls found.</p>
          ) : (
            <div className="space-y-2">
              {calls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between bg-sand-50/60 rounded-lg px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        call.direction === "inbound"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-sand-200 text-sand-600"
                      }`}
                    >
                      {call.direction === "inbound" ? "IN" : "OUT"}
                    </span>
                    {call.source && (
                      <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
                        call.source === "grasshopper" ? "bg-emerald-100 text-emerald-700" : "bg-sand-100 text-sand-500"
                      }`}>
                        {call.source === "grasshopper" ? "GH" : "CIK"}
                      </span>
                    )}
                    <span className="text-xs text-sand-700">
                      {formatDateTime(call.call_start)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-sand-500">
                      {call.duration_min} min
                    </span>
                    {call.endpoint?.toLowerCase().includes("vm") && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                        VM
                      </span>
                    )}
                    {call.direction === "inbound" && !call.endpoint && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded">
                        Missed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
