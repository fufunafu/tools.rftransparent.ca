"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// --- Types ---

interface EmailMetrics {
  total_inbound: number;
  total_outbound: number;
  inbound_threads: number;
  answered_threads: number;
  unanswered_threads: number;
  unanswered_rate: number;
  response_rate: number;
  avg_response_time: number | null;
}

interface SummaryResponse {
  current: EmailMetrics;
  previous: EmailMetrics;
  change: Record<string, number | null>;
  lastSync: { status: string; finishedAt: string | null; messagesSynced: number; errorMessage: string | null } | null;
  stores: { id: string; label: string }[];
}

interface UnansweredThread {
  thread_id: string;
  subject: string;
  from_email: string;
  received_at: string;
  message_count: number;
  snippet: string;
}

interface HistoryPoint {
  date: string;
  inbound: number;
  outbound: number;
  total: number;
}

// --- Helpers ---

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatResponseTime(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatShortDate(label: unknown) {
  if (typeof label !== "string") return "";
  const d = new Date(label + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChangeBadge({ value, invert }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null) return null;
  const positive = invert ? value < 0 : value > 0;
  const color = value === 0 ? "text-sand-400" : positive ? "text-green-600" : "text-red-500";
  return <span className={`text-xs font-medium ${color}`}>{value > 0 ? "+" : ""}{value}%</span>;
}

// --- Stores ---

type Range = "today" | "7d" | "30d" | "90d";
const RANGE_OPTIONS: { value: Range; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "7d", label: "7 Days", days: 7 },
  { value: "30d", label: "30 Days", days: 30 },
  { value: "90d", label: "90 Days", days: 90 },
];

const UNANSWERED_TARGET = 10;
const RESPONSE_TIME_TARGET = 240; // 4 hours in minutes

// --- Component ---

export default function EmailDashboard({ defaultStore }: { defaultStore?: string }) {
  const [store, setStore] = useState(defaultStore || "rf_transparent");
  const [stores, setStores] = useState<{ id: string; label: string }[]>([]);
  const [range, setRange] = useState<Range>("7d");
  const [mode, setMode] = useState<"staff" | "admin">("staff");
  const [mounted, setMounted] = useState(false);

  const [data, setData] = useState<SummaryResponse | null>(null);
  const [threads, setThreads] = useState<UnansweredThread[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const savedStore = localStorage.getItem("cs_email_store");
    if (savedStore) setStore(savedStore);
    const savedMode = localStorage.getItem("cs_email_mode");
    if (savedMode === "staff" || savedMode === "admin") setMode(savedMode);
    setMounted(true);
  }, []);

  const from = range === "today" ? todayStr() : daysAgoStr(RANGE_OPTIONS.find((r) => r.value === range)?.days ?? 7);
  const to = todayStr();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, threadsRes, historyRes] = await Promise.all([
        fetch(`/api/customer-service/emails?store=${store}&from=${from}&to=${to}`),
        fetch(`/api/customer-service/emails?view=threads&store=${store}&from=${from}&to=${to}`),
        fetch(`/api/customer-service/emails?view=history&store=${store}&from=${from}&to=${to}`),
      ]);

      if (!summaryRes.ok) throw new Error("Failed to load email data");

      const summary = await summaryRes.json();
      const threadsData = await threadsRes.json();
      const historyData = await historyRes.json();

      setData(summary);
      setStores(summary.stores ?? []);
      setThreads(threadsData.threads ?? []);
      setHistory(historyData.history ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [store, from, to]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus("");
    try {
      const res = await fetch(`/api/customer-service/emails?store=${store}`, { method: "POST" });
      const json = await res.json();
      if (json.status === "success") {
        setSyncStatus(`Synced ${json.messages_synced} messages`);
        loadData();
      } else {
        setSyncStatus(`Error: ${json.error}`);
      }
    } catch {
      setSyncStatus("Failed to reach sync endpoint");
    } finally {
      setSyncing(false);
    }
  };

  const metrics = data?.current;
  const change = data?.change;

  const unansweredRate = metrics?.unanswered_rate ?? 0;
  const avgRespTime = metrics?.avg_response_time ?? 0;
  const unansweredOnTrack = unansweredRate <= UNANSWERED_TARGET;
  const respTimeOnTrack = avgRespTime <= RESPONSE_TIME_TARGET;
  const allOnTrack = unansweredOnTrack && respTimeOnTrack;

  const staffCards = [
    { label: "Inbound", value: metrics?.total_inbound ?? 0, prev: data?.previous?.total_inbound ?? 0, change: change?.total_inbound, format: (n: number) => String(n) },
    { label: "Outbound", value: metrics?.total_outbound ?? 0, prev: data?.previous?.total_outbound ?? 0, change: change?.total_outbound, format: (n: number) => String(n) },
    { label: "Unanswered", value: unansweredRate, prev: data?.previous?.unanswered_rate ?? 0, change: change?.unanswered_rate, format: (n: number) => `${n}%`, target: UNANSWERED_TARGET, invert: true, subtitle: `${metrics?.unanswered_threads ?? 0} unanswered out of ${metrics?.inbound_threads ?? 0} threads`, tooltip: "Threads with no staff reply ÷ total inbound threads × 100." },
    { label: "Avg Response", value: avgRespTime, prev: data?.previous?.avg_response_time ?? 0, change: change?.avg_response_time, format: formatResponseTime, target: RESPONSE_TIME_TARGET, invert: true, subtitle: "Target: respond within 4 hours", tooltip: "Average time from customer email to first staff reply in the thread." },
  ];

  return (
    <div className="mt-6 space-y-5">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={store}
            onChange={(e) => { setStore(e.target.value); localStorage.setItem("cs_email_store", e.target.value); }}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-sand-200 rounded-lg text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-sand-100/60 rounded-lg p-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  range === opt.value ? "bg-white text-sand-900 shadow-sm" : "text-sand-500 hover:text-sand-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {mounted && mode === "admin" && (
            <div className="text-center">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-1.5 text-xs font-medium text-white bg-sand-900 rounded-lg hover:bg-sand-800 disabled:opacity-50 transition-colors"
              >
                {syncing ? "Syncing..." : "Sync Emails"}
              </button>
              {data?.lastSync?.finishedAt && (
                <p className="text-[10px] text-sand-400 mt-0.5">Last: {formatDateTime(data.lastSync.finishedAt)}</p>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => { const m = mode === "staff" ? "admin" : "staff"; setMode(m); localStorage.setItem("cs_email_mode", m); }}
          className="px-2.5 py-1 text-[11px] text-sand-400 hover:text-sand-600 border border-sand-200 rounded-md hover:bg-sand-50 transition-colors"
        >
          {mode === "staff" ? "Admin" : "Staff"} view
        </button>
      </div>

      {/* Sync status */}
      {syncStatus && (
        <div className={`rounded-xl border p-3 text-sm flex items-center justify-between ${
          syncStatus.startsWith("Synced") ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"
        }`}>
          <span>{syncStatus}</span>
          <button onClick={() => setSyncStatus("")} className="text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-sand-300 border-t-sand-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status banner */}
          {allOnTrack ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-emerald-600 text-lg">&#10003;</span>
              <div>
                <p className="text-sm font-medium text-emerald-800">All targets met</p>
                <p className="text-xs text-emerald-600">Unanswered {unansweredRate}% (target: &le;{UNANSWERED_TARGET}%) &middot; Avg response {formatResponseTime(avgRespTime)} (target: &le;4h)</p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="text-amber-500 text-lg mt-0.5">&#9888;</span>
                <div className="space-y-1">
                  {!unansweredOnTrack && (
                    <p className="text-sm text-amber-800">
                      <span className="font-medium">Unanswered rate is {unansweredRate}%</span>
                      <span className="text-amber-600"> — target is &le;{UNANSWERED_TARGET}%. {metrics?.unanswered_threads ?? 0} thread{(metrics?.unanswered_threads ?? 0) !== 1 ? "s" : ""} need a reply.</span>
                    </p>
                  )}
                  {!respTimeOnTrack && (
                    <p className="text-sm text-amber-800">
                      <span className="font-medium">Avg response time is {formatResponseTime(avgRespTime)}</span>
                      <span className="text-amber-600"> — target is &le;4 hours.</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {staffCards.map((c) => {
              const hasTarget = c.target != null;
              const target = c.target ?? 0;
              let progress = 0;
              let onTrack = true;
              if (hasTarget) {
                progress = target > 0 ? Math.min(c.value / target, 1) : 0;
                onTrack = c.value <= target;
              }
              return (
                <div key={c.label} className="bg-white rounded-xl border border-sand-200/60 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[11px] text-sand-400 uppercase tracking-wider">{c.label}</p>
                    {hasTarget && (
                      <span className={`text-[10px] font-medium ${onTrack ? "text-emerald-500" : "text-amber-500"}`}>
                        {onTrack ? "✓" : "!"} &le;{c.label === "Avg Response" ? "4h" : `${target}%`}
                      </span>
                    )}
                  </div>
                  <p className="text-xl font-semibold text-sand-900">{c.format(c.value)}</p>
                  {c.subtitle && <p className="text-[11px] text-sand-400 mt-0.5">{c.subtitle}</p>}
                  {hasTarget && (
                    <div className="mt-2 h-1.5 bg-sand-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${onTrack ? "bg-emerald-400" : "bg-amber-400"}`}
                        style={{ width: `${Math.max(progress * 100, 4)}%` }}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-sand-400">prev: {c.format(c.prev)}</span>
                    <ChangeBadge value={c.change ?? null} invert={c.invert} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Unanswered threads */}
          <div>
            <h2 className="text-sm font-semibold text-sand-700 mb-2">Unanswered — Action Needed</h2>
            {threads.length === 0 ? (
              <div className="bg-white rounded-xl border border-sand-200/60 p-8 text-center">
                <p className="text-sand-500 text-sm">All emails have been answered.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-sand-100 text-left">
                        <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">From</th>
                        <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Subject</th>
                        <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Received</th>
                        <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Waiting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {threads.map((t) => (
                        <tr key={t.thread_id} className="border-b border-sand-50 hover:bg-sand-50/50">
                          <td className="px-4 py-2.5 text-sand-700 font-medium">{t.from_email}</td>
                          <td className="px-4 py-2.5 text-sand-600 max-w-xs truncate" title={t.subject}>{t.subject}</td>
                          <td className="px-4 py-2.5 text-sand-500">{formatDateTime(t.received_at)}</td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs text-amber-600 font-medium">{timeAgo(t.received_at)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Volume chart (admin mode) */}
          {mounted && mode === "admin" && history.length > 1 && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-5">
              <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-4">Email Volume</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0db" />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a09888" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#a09888" }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: "1px solid #e5e0db", fontSize: 12 }}
                      labelFormatter={formatShortDate}
                    />
                    <Area type="monotone" dataKey="inbound" name="Inbound" stackId="1" stroke="#5b7a5e" fill="#5b7a5e" fillOpacity={0.3} />
                    <Area type="monotone" dataKey="outbound" name="Outbound" stackId="1" stroke="#8b7355" fill="#8b7355" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
