"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  BarChart,
  Bar,
} from "recharts";

type Range = "today" | "7d" | "30d" | "90d" | "custom";
type Tab = "overview" | "callbacks" | "call-log";

interface Metrics {
  total_calls: number;
  inbound_calls: number;
  outbound_calls: number;
  vm_calls: number;
  missed_calls: number;
  miss_rate: number;
  callbacks_needed: number;
  avg_duration: number;
  avg_response_time: number | null;
  recovery_rate: number;
  first_time_callers: number;
  returning_callers: number;
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
}

interface CallbacksResponse {
  callbacks: CallbackGroup[];
  totalMissed: number;
  uniqueCallers: number;
  highPriority: number;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

function formatShortDate(label: unknown) {
  const dateStr = String(label);
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function exportCallbacksCsv(callbacks: CallbackGroup[]) {
  const header = "Phone Number,Attempts,Priority,Last Call,First Call,Total Duration (min),Status,Note\n";
  const rows = callbacks.map((cb) =>
    [
      formatPhoneNumber(cb.from_number),
      cb.attempts,
      cb.priority,
      cb.last_call,
      cb.first_call,
      cb.total_duration,
      cb.note_status || "pending",
      `"${(cb.note || "").replace(/"/g, '""')}"`,
    ].join(",")
  );
  const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `callbacks-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

const METRIC_CARDS: {
  key: keyof Metrics;
  label: string;
  format: (v: number) => string;
  invert?: boolean;
  tooltip?: string;
}[] = [
  { key: "total_calls", label: "Total Calls", format: formatNumber, tooltip: "Total number of inbound + outbound calls in the selected period." },
  { key: "inbound_calls", label: "Inbound", format: formatNumber, tooltip: "Calls received from customers." },
  { key: "outbound_calls", label: "Outbound", format: formatNumber, tooltip: "Calls made by your team to customers." },
  { key: "missed_calls", label: "Missed Calls", format: formatNumber, invert: true, tooltip: "Inbound calls that went unanswered (no pickup, no voicemail)." },
  { key: "miss_rate", label: "Miss Rate", format: (v) => `${v}%`, invert: true, tooltip: "Percentage of inbound calls that were missed. Calculated as: missed calls \u00f7 inbound calls \u00d7 100. Industry average is 10\u201320%." },
  { key: "vm_calls", label: "Voicemails", format: formatNumber, tooltip: "Calls that went to voicemail." },
  { key: "avg_response_time", label: "Avg Response", format: formatResponseTime, tooltip: "Average time (in minutes) between a missed call and the first outbound callback to that number." },
  { key: "avg_duration", label: "Avg Duration", format: (v) => `${v} min`, tooltip: "Average length of answered calls. Also known as Average Handle Time (AHT). Industry average is 4\u20136 minutes." },
  { key: "first_time_callers", label: "New Callers", format: formatNumber, tooltip: "Unique phone numbers calling for the first time in this period." },
  { key: "returning_callers", label: "Returning", format: formatNumber, tooltip: "Phone numbers that have called more than once in this period." },
];

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
    tooltip: "Percentage of missed callers who were called back. Calculated as: callers who received a callback \u00f7 total unanswered calls \u00d7 100. Higher is better \u2014 above 80% is excellent.",
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
    tooltip: "Average time in minutes between a missed call and the callback to that caller. Only includes calls that were actually called back. Under 15 min is excellent, over 60 min needs improvement.",
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
    tooltip: "Percentage of inbound callers who needed a callback because their call was missed. Calculated as: unanswered calls \u00f7 total inbound calls \u00d7 100. Lower is better \u2014 means more calls are answered on the first try.",
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

export default function CustomerServiceDashboard() {
  const [store, setStore] = useState(STORE_OPTIONS[0].id);
  const [source, setSource] = useState<Source>("all");
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [callbackData, setCallbackData] = useState<CallbacksResponse | null>(null);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshElapsed, setRefreshElapsed] = useState(0);
  const [refreshStatus, setRefreshStatus] = useState("");
  const [error, setError] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [ghScraping, setGhScraping] = useState(false);
  const [ghStatus, setGhStatus] = useState("");
  const [ghElapsed, setGhElapsed] = useState(0);
  const [gh2faNeeded, setGh2faNeeded] = useState(false);
  const [gh2faCode, setGh2faCode] = useState("");
  const [ghError, setGhError] = useState("");
  const [ghLogs, setGhLogs] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ghDiagnostics, setGhDiagnostics] = useState<any>(null);
  const [syncKey, setSyncKey] = useState(0);

  const from = range === "custom" ? customFrom : range === "today" ? todayStr() : daysAgoStr(RANGE_OPTIONS.find((r) => r.value === range)?.days ?? 7);
  const to = range === "custom" ? customTo : todayStr();

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

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshElapsed(0);
    setRefreshStatus("");
    const timer = setInterval(() => {
      setRefreshElapsed((prev) => prev + 1);
    }, 1000);
    try {
      const res = await fetch(`/api/customer-service?store=${store}`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.status === "success") {
        setRefreshStatus(`Done — ${json.records_inserted ?? 0} records synced`);
        setSyncKey((k) => k + 1);
        await Promise.all([loadSummary(), loadHistory(), loadCallbacks(), loadPatterns()]);
      } else if (json.status === "already_running") {
        setRefreshStatus("A refresh is already in progress, please wait...");
      } else if (json.status === "error") {
        setRefreshStatus(`Error: ${json.error || "Scrape failed"}`);
      }
    } catch {
      setRefreshStatus("Failed to reach scraper service");
    } finally {
      clearInterval(timer);
      setRefreshing(false);
      setRefreshElapsed(0);
    }
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
    let needs2fa = false;
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
        needs2fa = true;
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
    setRefreshStatus("");
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

      setSyncAllStatus(`Done — ${results.join(" · ")}`);
      setSyncKey((k) => k + 1);
      await Promise.all([loadSummary(), loadHistory(), loadCallbacks(), loadPatterns()]);
    } finally {
      clearInterval(timer);
      setSyncAllRunning(false);
    }
  };

  const callbacks = callbackData?.callbacks ?? [];

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
    <div className="mt-6 space-y-5">
      {/* Controls bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {/* Store selector */}
          <select
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-sand-200 rounded-lg text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
          >
            {STORE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Source filter */}
          <div className="flex items-center gap-1 bg-sand-100/60 rounded-lg p-0.5">
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  source === opt.value
                    ? "bg-white text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Range selector */}
          <div className="flex items-center gap-1 bg-sand-100/60 rounded-lg p-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === opt.value
                  ? "bg-white text-sand-900 shadow-sm"
                  : "text-sand-500 hover:text-sand-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
            <button
              onClick={() => setRange("custom")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === "custom"
                  ? "bg-white text-sand-900 shadow-sm"
                  : "text-sand-500 hover:text-sand-700"
              }`}
            >
              Custom
            </button>
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 text-xs border border-sand-200 rounded-md bg-white text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
              />
              <span className="text-xs text-sand-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 text-xs border border-sand-200 rounded-md bg-white text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Sub-tabs */}
          <div className="flex items-center gap-1 bg-sand-100/60 rounded-lg p-0.5">
            {(["overview", "call-log", "callbacks"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === t
                    ? "bg-white text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-700"
                }`}
              >
                {t === "call-log" ? "Call Log" : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === "callbacks" && callbacks.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px]">
                    {callbacks.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Sync & actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-medium text-sand-500 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors print:hidden"
              title="Save as PDF from the print dialog"
            >
              Download Report
            </button>
            <div className="text-center">
              <button
                onClick={handleSyncAll}
                disabled={syncAllRunning || refreshing || ghScraping}
                className="px-4 py-1.5 text-xs font-medium text-white bg-sand-900 rounded-lg hover:bg-sand-800 disabled:opacity-50 transition-colors"
              >
                {syncAllRunning ? "Syncing..." : "Sync All"}
              </button>
              <div className="flex gap-3 mt-0.5 justify-center">
                {data?.lastSync?.cik && (
                  <p className="text-[10px] text-sand-400" title={data.lastSync.cik}>CIK: {formatSyncTime(data.lastSync.cik)}</p>
                )}
                {data?.lastSync?.grasshopper && (
                  <p className="text-[10px] text-emerald-400" title={data.lastSync.grasshopper}>GH: {formatSyncTime(data.lastSync.grasshopper)}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sync All progress */}
      {syncAllRunning && <SyncInProgress label="Syncing All (CIK + Grasshopper)" elapsed={syncAllElapsed} color="sand" />}
      {!syncAllRunning && syncAllStatus && (
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

      {/* CIK refresh progress / result (for individual syncs) */}
      {refreshing && <SyncInProgress label="Syncing CIK" elapsed={refreshElapsed} color="sand" />}
      {!refreshing && refreshStatus && (
        <div className={`rounded-xl border p-4 text-sm ${
          refreshStatus.startsWith("Done")
            ? "bg-emerald-50 border-emerald-200"
            : refreshStatus.startsWith("Error") || refreshStatus.startsWith("Failed")
              ? "bg-red-50 border-red-200"
              : "bg-sand-50 border-sand-200"
        }`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`font-semibold ${
                refreshStatus.startsWith("Done") ? "text-emerald-700"
                  : refreshStatus.startsWith("Error") || refreshStatus.startsWith("Failed") ? "text-red-700"
                    : "text-sand-700"
              }`}>
                {refreshStatus.startsWith("Done") ? "CIK Sync Complete" : refreshStatus.startsWith("Error") || refreshStatus.startsWith("Failed") ? "CIK Sync Failed" : "CIK Sync"}
              </p>
              <p className={`text-xs mt-0.5 ${
                refreshStatus.startsWith("Done") ? "text-emerald-600"
                  : refreshStatus.startsWith("Error") || refreshStatus.startsWith("Failed") ? "text-red-500"
                    : "text-sand-500"
              }`}>
                {refreshStatus}
              </p>
            </div>
            <button
              onClick={() => setRefreshStatus("")}
              className="text-xs text-sand-400 hover:text-sand-600 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Grasshopper progress */}
      {ghScraping && (
        <SyncInProgress label="Syncing Grasshopper" elapsed={ghElapsed} color="emerald" />
      )}

      {/* Grasshopper 2FA prompt */}
      {gh2faNeeded && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <p className="text-sm text-emerald-800 font-medium">
            Grasshopper requires email verification
          </p>
          <p className="text-xs text-emerald-600">
            Check your email (fuanne@glass-railing.com) for a verification code, then enter it below.
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

      {/* Grasshopper sync result */}
      {!ghScraping && ghStatus && !gh2faNeeded && (
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
                  {Object.entries(ghDiagnostics.per_store).map(([storeId, info]: [string, any]) => (
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

      {/* Last scrape error */}
      {data?.lastScrape?.status === "error" && (
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
      ) : tab === "overview" ? (
        <OverviewTab data={data} history={history} hourly={hourly} daily={daily} />
      ) : tab === "callbacks" ? (
        <CallbacksTab data={callbackData} store={store} loadCallbacks={loadCallbacks} selectedNumber={selectedNumber} setSelectedNumber={setSelectedNumber} />
      ) : (
        <CallLogTab store={store} source={source} from={from} to={to} onNumberClick={setSelectedNumber} syncKey={syncKey} />
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
    insights.push({ text: `Recovery rate of ${metrics.recovery_rate}% is excellent — you're calling back most missed callers.`, type: "positive" });
  } else if (metrics.recovery_rate >= 60) {
    insights.push({ text: `Recovery rate of ${metrics.recovery_rate}% is solid — most missed callers are getting a callback.`, type: "positive" });
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
    insights.push({ text: `Recovery rate of ${metrics.recovery_rate}% is below average. Aim to call back every missed caller within the same business day.`, type: "improvement" });
  }

  if (metrics.avg_response_time != null && metrics.avg_response_time > 60) {
    insights.push({ text: `Average callback time of ${metrics.avg_response_time} min is over an hour. Try to return missed calls within 30 minutes during business hours.`, type: "improvement" });
  }

  if (metrics.avg_duration > 6) {
    insights.push({ text: `Average handle time of ${metrics.avg_duration} min is above the 4-6 min benchmark. Consider preparing FAQ scripts for common questions to speed up calls.`, type: "improvement" });
  }

  if (callbackRate > 15) {
    insights.push({ text: `Callback rate of ${callbackRate}% is high. Prioritize answering inbound calls over other tasks to reduce the need for callbacks.`, type: "improvement" });
  } else if (callbackRate > 5) {
    insights.push({ text: `Callback rate of ${callbackRate}% could be improved. Try to return missed calls within 30 minutes during business hours.`, type: "improvement" });
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

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5 space-y-3">
      <p className="text-xs text-sand-400 uppercase tracking-wider">
        Insights & Recommendations
      </p>
      <div className="space-y-2.5">
        {insights.map((insight, i) => (
          <div key={i} className="flex gap-2">
            <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
              insight.type === "positive"
                ? "bg-green-100 text-green-600"
                : "bg-amber-100 text-amber-600"
            }`}>
              {insight.type === "positive" ? "\u2713" : "!"}
            </span>
            <p className="text-[12px] text-sand-600 leading-relaxed">{insight.text}</p>
          </div>
        ))}
      </div>
    </div>
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
    <div className="bg-white rounded-xl border border-sand-200/60 p-5 space-y-4">
      <p className="text-xs text-sand-400 uppercase tracking-wider">
        Industry Benchmarks
      </p>
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

  const maxDaily = Math.max(...daily.map((d) => d.total_calls), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
      {/* Main content — 3/4 width */}
      <div className="lg:col-span-3 space-y-5">
        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {METRIC_CARDS.map((m) => (
            <div
              key={m.key}
              className="bg-white rounded-xl border border-sand-200/60 p-4"
            >
              <div className="flex items-center gap-1 mb-1">
                <p className="text-[11px] text-sand-400 uppercase tracking-wider">
                  {m.label}
                </p>
                {m.tooltip && <InfoTip text={m.tooltip} />}
              </div>
              <p className="text-xl font-semibold text-sand-900">
                {m.format((data.current[m.key] as number) ?? 0)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-sand-400">
                  prev: {m.format((data.previous[m.key] as number) ?? 0)}
                </span>
                <ChangeBadge value={data.change[m.key]} invert={m.invert} />
              </div>
            </div>
          ))}
        </div>

        {/* Trend charts */}
        {history.length > 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Call volume chart */}
            <div className="bg-white rounded-xl border border-sand-200/60 p-5">
              <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">
                Call Volume
              </p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 11, fill: "#a39e93" }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} />
                    <Tooltip
                      labelFormatter={formatShortDate}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e5e0da",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="inbound"
                      name="Inbound"
                      stackId="1"
                      stroke="#5b7a5e"
                      fill="#5b7a5e"
                      fillOpacity={0.3}
                    />
                    <Area
                      type="monotone"
                      dataKey="outbound"
                      name="Outbound"
                      stackId="1"
                      stroke="#8b7355"
                      fill="#8b7355"
                      fillOpacity={0.2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Miss rate chart */}
            <div className="bg-white rounded-xl border border-sand-200/60 p-5">
              <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">
                Miss Rate %
              </p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      tick={{ fontSize: 11, fill: "#a39e93" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#a39e93" }}
                      unit="%"
                    />
                    <Tooltip
                      labelFormatter={formatShortDate}
                      formatter={(value) => [`${value}%`, "Miss Rate"]}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e5e0da",
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="miss_rate"
                      name="Miss Rate"
                      stroke="#c0392b"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#c0392b" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Peak hours chart */}
        {hourly.some((h) => h.total_calls > 0) && (
          <div className="bg-white rounded-xl border border-sand-200/60 p-5">
            <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">
              Calls by Hour of Day
            </p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly.filter((h) => h.hour >= 8 && h.hour <= 20)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#a39e93" }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e5e0da",
                      fontSize: 12,
                    }}
                    formatter={(value, name) => [value, name]}
                  />
                  <Bar
                    dataKey="answered"
                    name="Answered"
                    stackId="a"
                    fill="#5b7a5e"
                    fillOpacity={0.7}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="missed"
                    name="Missed"
                    stackId="a"
                    fill="#c0392b"
                    fillOpacity={0.7}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Busiest days of week */}
        {daily.some((d) => d.total_calls > 0) && (
          <div className="bg-white rounded-xl border border-sand-200/60 p-5">
            <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">
              Busiest Days of Week
            </p>
            <div className="grid grid-cols-7 gap-2">
              {daily.map((d) => {
                const pct = maxDaily > 0 ? (d.total_calls / maxDaily) * 100 : 0;
                const avgPerDay = d.dayCount > 0 ? Math.round(d.total_calls / d.dayCount) : 0;
                return (
                  <div key={d.label} className="text-center space-y-1.5">
                    <p className="text-[11px] font-medium text-sand-600">{d.label}</p>
                    <div className="mx-auto w-full h-16 bg-sand-50 rounded-md relative overflow-hidden">
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-sand-300 rounded-t-sm transition-all"
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs font-semibold text-sand-800">{avgPerDay}</p>
                    <p className="text-[10px] text-sand-400">avg/day</p>
                    {d.miss_rate > 0 && (
                      <p className={`text-[10px] ${d.miss_rate > 20 ? "text-red-500" : "text-sand-400"}`}>
                        {d.miss_rate}% missed
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar — benchmarks + insights */}
      <div className="lg:col-span-1 space-y-5">
        <BenchmarkPanel metrics={data.current} previous={data.previous} />
        <InsightsPanel metrics={data.current} daily={daily} />
      </div>
    </div>
  );
}

function CallbacksTab({
  data,
  store,
  loadCallbacks,
  selectedNumber,
  setSelectedNumber,
}: {
  data: CallbacksResponse | null;
  store: string;
  loadCallbacks: () => Promise<void>;
  selectedNumber: string | null;
  setSelectedNumber: (n: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [callbackSort, setCallbackSort] = useState<"priority" | "recent">("recent");

  const rawCallbacks = data?.callbacks ?? [];

  const callbacks = useMemo(() => {
    const sorted = [...rawCallbacks];
    if (callbackSort === "recent") {
      sorted.sort((a, b) => new Date(b.last_call).getTime() - new Date(a.last_call).getTime());
    }
    return sorted;
  }, [rawCallbacks, callbackSort]);

  if (callbacks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-sand-200/60 p-10 text-center">
        <p className="text-sand-500 text-sm">
          No callbacks needed — all calls have been handled.
        </p>
      </div>
    );
  }

  const toggleExpand = (number: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  const priorityDot: Record<string, string> = {
    high: "bg-red-500",
    medium: "bg-yellow-500",
    low: "bg-sand-300",
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-sand-900">{data?.uniqueCallers ?? 0}</span>
          <span className="text-xs text-sand-500">unique callers need callbacks</span>
        </div>
        {(data?.highPriority ?? 0) > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs text-red-600 font-medium">
              {data?.highPriority} called 3+ times
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-sand-400">
            {data?.totalMissed ?? 0} total missed calls
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 bg-sand-100/60 rounded-lg p-0.5">
            {(["priority", "recent"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setCallbackSort(opt)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  callbackSort === opt
                    ? "bg-white text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-700"
                }`}
              >
                {opt === "priority" ? "Priority" : "Latest"}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => exportCallbacksCsv(callbacks)}
          className="px-3 py-1.5 text-xs font-medium text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Callback table */}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 text-left">
                <th className="px-5 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium w-8" />
                <th className="px-5 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">
                  Phone Number
                </th>
                <th className="px-5 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">
                  Attempts
                </th>
                <th className="px-5 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">
                  Last Call
                </th>
                <th className="px-5 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">
                  Duration
                </th>
                <th className="px-5 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">
                  Response
                </th>
              </tr>
            </thead>
            <tbody>
              {callbacks.map((cb) => {
                const isExpanded = expanded.has(cb.from_number);
                return (
                  <CallbackRow
                    key={cb.from_number}
                    cb={cb}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(cb.from_number)}
                    priorityDot={priorityDot}
                    store={store}
                    loadCallbacks={loadCallbacks}
                    onNumberClick={() => setSelectedNumber(cb.from_number)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CallbackRow({
  cb,
  isExpanded,
  onToggle,
  priorityDot,
  store,
  loadCallbacks,
  onNumberClick,
}: {
  cb: CallbackGroup;
  isExpanded: boolean;
  onToggle: () => void;
  priorityDot: Record<string, string>;
  store: string;
  loadCallbacks: () => Promise<void>;
  onNumberClick: () => void;
}) {
  const [note, setNote] = useState(cb.note || "");
  const [saving, setSaving] = useState(false);

  const saveNote = async (status: string) => {
    setSaving(true);
    try {
      await fetch(`/api/customer-service?view=note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: store,
          from_number: cb.from_number,
          note,
          status,
        }),
      });
      await loadCallbacks();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <tr
        className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="pl-5 py-3">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${priorityDot[cb.priority] ?? "bg-sand-300"}`} />
        </td>
        <td className="px-5 py-3">
          <PhoneLink number={cb.from_number} onClick={onNumberClick} />
          {cb.is_first_time && (
            <span className="ml-2 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
              New
            </span>
          )}
          {cb.note_status === "done" && (
            <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
              Done
            </span>
          )}
        </td>
        <td className="px-5 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            cb.priority === "high"
              ? "bg-red-100 text-red-700"
              : cb.priority === "medium"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-sand-100 text-sand-600"
          }`}>
            {cb.attempts}x
          </span>
        </td>
        <td className="px-5 py-3 text-sand-600">
          <span>{formatDateTime(cb.last_call)}</span>
          <span className="text-sand-400 text-xs ml-1.5">({timeAgo(cb.last_call)})</span>
        </td>
        <td className="px-5 py-3 text-sand-600">
          {cb.total_duration} min
        </td>
        <td className="px-5 py-3">
          {cb.response_time_min != null ? (
            <span className="text-xs text-green-600">{formatResponseTime(cb.response_time_min)}</span>
          ) : (
            <span className="text-xs text-sand-400">No callback</span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <>
          {cb.calls.length > 1 && cb.calls.map((call) => (
            <tr key={call.id} className="bg-sand-50/40">
              <td />
              <td className="px-5 py-2 text-xs text-sand-400 pl-12">
                &mdash;
                {call.source && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    call.source === "grasshopper" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {call.source === "grasshopper" ? "GH" : "CIK"}
                  </span>
                )}
              </td>
              <td />
              <td className="px-5 py-2 text-xs text-sand-500">
                {formatDateTime(call.call_start)}
              </td>
              <td className="px-5 py-2 text-xs text-sand-500">
                {call.duration_min} min
              </td>
              <td />
            </tr>
          ))}
          {/* Notes section */}
          <tr className="bg-sand-50/30">
            <td colSpan={6} className="px-5 py-3">
              <div className="flex items-start gap-3">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 text-xs text-sand-700 bg-white border border-sand-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sand-400 resize-none"
                />
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); saveNote("done"); }}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "..." : "Mark Done"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); saveNote("pending"); }}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 disabled:opacity-50 transition-colors"
                  >
                    Save Note
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </>
      )}
    </>
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
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [phone, setPhone] = useState("");

  const hasFilters = direction !== "all" || status !== "all" || minDuration !== "" || maxDuration !== "" || phone !== "";

  const clearFilters = () => {
    setDirection("all");
    setStatus("all");
    setMinDuration("");
    setMaxDuration("");
    setPhone("");
  };

  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (direction !== "all") params.set("direction", direction);
    if (status !== "all") params.set("status", status);
    if (minDuration) params.set("minDuration", minDuration);
    if (maxDuration) params.set("maxDuration", maxDuration);
    if (phone) params.set("phone", phone);
    return params.toString();
  };

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const filterStr = buildFilterParams();
      const res = await fetch(
        `/api/customer-service?view=call-log&store=${store}&source=${source}&from=${from}&to=${to}&page=${p}${filterStr ? `&${filterStr}` : ""}`
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
  }, [store, source, from, to, direction, status, minDuration, maxDuration, phone, syncKey]);

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
    // Extension number = answered on that extension
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
          `/api/customer-service?view=call-log&store=${store}&source=${source}&from=${from}&to=${to}&page=${p}${filterStr ? `&${filterStr}` : ""}`
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
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Direction */}
          <div className="flex rounded-lg border border-sand-200 overflow-hidden">
            {(["all", "inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  direction === d
                    ? "bg-sand-900 text-sand-50"
                    : "bg-white text-sand-600 hover:bg-sand-50"
                }`}
              >
                {d === "all" ? "All" : d === "inbound" ? "Inbound" : "Outbound"}
              </button>
            ))}
          </div>

          {/* Status */}
          <div className="flex rounded-lg border border-sand-200 overflow-hidden">
            {(["all", "answered", "missed", "voicemail"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  status === s
                    ? "bg-sand-900 text-sand-50"
                    : "bg-white text-sand-600 hover:bg-sand-50"
                }`}
              >
                {s === "all" ? "All Status" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Duration range */}
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              placeholder="Min"
              value={minDuration}
              onChange={(e) => setMinDuration(e.target.value)}
              className="w-16 rounded-lg border border-sand-200 px-2 py-1.5 text-xs text-sand-700 bg-white placeholder:text-sand-300"
              min="0"
              step="0.5"
            />
            <span className="text-xs text-sand-400">-</span>
            <input
              type="number"
              placeholder="Max"
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
              className="w-16 rounded-lg border border-sand-200 px-2 py-1.5 text-xs text-sand-700 bg-white placeholder:text-sand-300"
              min="0"
              step="0.5"
            />
            <span className="text-xs text-sand-400">min</span>
          </div>

          {/* Phone search */}
          <input
            type="text"
            placeholder="Search phone..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-36 rounded-lg border border-sand-200 px-3 py-1.5 text-xs text-sand-700 bg-white placeholder:text-sand-300"
          />

          {/* Clear */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Summary & pagination */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-4 flex items-center justify-between">
        <span className="text-sm text-sand-600">
          {total.toLocaleString()} calls
          {hasFilters && <span className="ml-1.5 px-1.5 py-0.5 bg-sand-100 text-sand-500 rounded text-[10px] font-medium">filtered</span>}
        </span>
        <div className="flex items-center gap-2">
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

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-sand-300 border-t-sand-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
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
                {records.map((r) => (
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/customer-service?view=customer&store=${store}&source=${source}&number=${encodeURIComponent(number)}`)
      .then((r) => r.json())
      .then((data) => {
        setCalls(data.calls ?? []);
        setNote(data.note ?? "");
        setNoteStatus(data.note_status ?? "");
      })
      .finally(() => setLoading(false));
  }, [number, store, source]);

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
