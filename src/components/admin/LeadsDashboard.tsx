"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { CallStatus, Lead, LeadCallAttempt, LeadSource, Outcome } from "@/lib/customer-service/leads";
import { OUTCOME_LABELS, CALL_STATUS_LABELS } from "@/lib/customer-service/leads";
import {
  buildCustomLeadTrend,
  buildLeadTrend,
  type LeadTrendRange,
} from "@/lib/lead-analytics";
import { formatCADWhole } from "@/lib/format";

const LeadTrendChart = dynamic(() => import("@/components/admin/LeadTrendChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-sand-50 rounded-md" />,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return "No calls yet";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min avg response`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 24) return `${hours} hr avg response`;
  return `${Math.round((hours / 24) * 10) / 10} day avg response`;
}

const SOURCE_BADGE: Record<LeadSource, { label: string; className: string }> = {
  website: { label: "Website", className: "bg-blue-100 text-blue-700" },
  meta: { label: "Meta", className: "bg-rose-100 text-rose-700" },
};

type TrendSelection = LeadTrendRange | "custom";

const TREND_RANGES: { value: TrendSelection; label: string; metricLabel: string }[] = [
  { value: "30d", label: "30 days", metricLabel: "30 days" },
  { value: "90d", label: "90 days", metricLabel: "90 days" },
  { value: "12m", label: "12 months", metricLabel: "12 months" },
  { value: "custom", label: "Custom", metricLabel: "custom" },
];

function defaultCustomDates(): { from: string; to: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const key = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const now = new Date();
  return { from: key(new Date(now.getTime() - 29 * 86_400_000)), to: key(now) };
}

const OUTCOME_BADGE: Record<Outcome, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  quoted: "bg-indigo-100 text-indigo-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-slate-100 text-slate-500",
};

const CALL_BADGE: Record<CallStatus, string> = {
  not_called: "bg-amber-50 text-amber-700 border border-amber-200",
  no_answer: "bg-gray-100 text-gray-600 border border-gray-200",
  called: "bg-green-50 text-green-700 border border-green-200",
};

const FILTER_TABS: { value: string; label: string; match: (l: Lead) => boolean }[] = [
  { value: "uncalled", label: "Uncalled", match: (l) => l.call_status === "not_called" },
  { value: "no_quote", label: "Awaiting Quote", match: (l) => l.call_status !== "not_called" && !l.quote_number && l.outcome !== "won" && l.outcome !== "lost" },
  { value: "open_quote", label: "Open Quote", match: (l) => !!l.quote_number && l.outcome === "quoted" },
  { value: "won", label: "Won", match: (l) => l.outcome === "won" },
  { value: "lost", label: "Lost", match: (l) => l.outcome === "lost" },
  { value: "all", label: "All", match: () => true },
];

interface MetaStatus {
  configured: boolean;
  connected: boolean;
  page_name: string | null;
  subscribed: boolean;
  error: string | null;
  can_sync: boolean;
}

interface MetaSyncSummary {
  forms: number;
  fetched: number;
  inserted: number;
  deduped: number;
  skipped: number;
  failed: number;
  errors: string[];
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

// ─── Lead detail panel ───────────────────────────────────────────────────────

function LeadDetailPanel({
  lead,
  onClose,
  onChanged,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: attemptsData } = useSWR<{ attempts: LeadCallAttempt[] }>(
    `/api/customer-service/leads?view=call_attempts&lead_id=${lead.id}`,
    fetcher
  );
  const attempts = attemptsData?.attempts ?? [];

  const [logging, setLogging] = useState(false);
  const [callResult, setCallResult] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [logError, setLogError] = useState<string | null>(null);

  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(lead.quote_number ?? "");
  const [quoteAmount, setQuoteAmount] = useState(lead.quote_amount?.toString() ?? "");

  const handleLogCall = async () => {
    setLogging(true);
    setLogError(null);
    // Blank result is fine — default to "Called" so a one-click log works.
    const result = callResult.trim() || "Called";
    try {
      const res = await fetch("/api/customer-service/leads?action=log_call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, result, notes: callNotes.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLogError(body.error ?? `Failed to log call (${res.status})`);
        return;
      }
      setCallResult("");
      setCallNotes("");
      onChanged();
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLogging(false);
    }
  };

  const patchLead = async (update: Record<string, unknown>) => {
    await fetch("/api/customer-service/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, ...update }),
    });
    onChanged();
  };

  const handleSaveQuote = async () => {
    await patchLead({
      quote_number: quoteNumber.trim() || null,
      quote_amount: quoteAmount.trim() ? Number(quoteAmount) : null,
      quote_sent_at: quoteNumber.trim() ? new Date().toISOString() : null,
      outcome: quoteNumber.trim() && lead.outcome !== "won" && lead.outcome !== "lost" ? "quoted" : lead.outcome,
    });
    setEditingQuote(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-sand-200/60 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-lg font-semibold text-sand-900">{lead.name || "Unnamed lead"}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[lead.source].className}`}>
                {SOURCE_BADGE[lead.source].label}
              </span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                {OUTCOME_LABELS[lead.outcome]}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-sand-400 hover:text-sand-600 p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {(lead.phone || lead.email) && (
          <div className="px-6 py-3 border-b border-sand-200/60 flex gap-2">
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="flex-1 text-center px-3 py-2 rounded-md bg-blue-600 text-sm font-medium text-white hover:bg-blue-700"
              >
                Call {lead.phone}
              </a>
            )}
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="flex-1 text-center px-3 py-2 rounded-md border border-sand-300 bg-white text-sm font-medium text-sand-700 hover:bg-sand-50"
              >
                Email lead
              </a>
            )}
          </div>
        )}

        {/* Submission */}
        <div className="px-6 py-5 border-b border-sand-200/60 space-y-3">
          <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Submission</h4>
          <div className="space-y-1.5 text-sm">
            {lead.source_detail && (
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Source</span>
                <span className="text-sand-700 text-right truncate max-w-[240px]">{lead.source_detail}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-sand-500">Submitted</span>
              <span className="text-sand-700">{formatDateTime(lead.submitted_at)}</span>
            </div>
            {lead.email && (
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Email</span>
                <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">{lead.email}</a>
              </div>
            )}
            {lead.phone && (
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Phone</span>
                <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">{lead.phone}</a>
              </div>
            )}
          </div>
          {lead.message && (
            <div className="rounded-lg bg-sand-50 border border-sand-200/60 p-3 text-sm text-sand-700 whitespace-pre-wrap">
              {lead.message}
            </div>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-sand-400 hover:text-sand-600">Raw submission</summary>
            <pre className="mt-2 p-2 rounded bg-sand-50 border border-sand-200/60 overflow-x-auto text-[11px] text-sand-600">{JSON.stringify(lead.raw_payload, null, 2)}</pre>
          </details>
        </div>

        {/* Call log */}
        <div className="px-6 py-5 border-b border-sand-200/60 space-y-3">
          <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Call Log</h4>
          {attempts.length === 0 ? (
            <p className="text-sm text-sand-400">No calls logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {attempts.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-sand-100 flex items-center justify-center text-xs font-medium text-sand-600 shrink-0 uppercase">
                    {a.staff.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-sand-900 truncate">{a.staff}</span>
                      <span className="text-[11px] text-sand-400 whitespace-nowrap">{formatDateTime(a.called_at)}</span>
                    </div>
                    <p className="text-sm text-sand-600">{a.result}</p>
                    {a.notes && <p className="text-xs text-sand-500 mt-0.5">{a.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-sand-200 p-3 space-y-2">
            <input
              type="text"
              value={callResult}
              onChange={(e) => setCallResult(e.target.value)}
              placeholder="Call result (e.g. Spoke — interested)"
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text"
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleLogCall}
              disabled={logging}
              className="w-full px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {logging ? "Logging..." : "+ Log Call"}
            </button>
            {logError && (
              <p className="text-xs text-red-600">{logError}</p>
            )}
          </div>
        </div>

        {/* Quote */}
        <div className="px-6 py-5 border-b border-sand-200/60 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quote</h4>
            {!editingQuote && (
              <button onClick={() => setEditingQuote(true)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                {lead.quote_number ? "Edit" : "+ Link Quote"}
              </button>
            )}
          </div>
          {editingQuote ? (
            <div className="rounded-lg border border-sand-200 p-3 space-y-2">
              <input
                type="text"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                placeholder="Quote / draft order # (e.g. D-10421)"
                className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="number"
                value={quoteAmount}
                onChange={(e) => setQuoteAmount(e.target.value)}
                placeholder="Amount (CAD)"
                className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingQuote(false)} className="px-3 py-1.5 text-xs text-sand-600">Cancel</button>
                <button onClick={handleSaveQuote} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded">Save</button>
              </div>
            </div>
          ) : lead.quote_number ? (
            <div className="rounded-lg bg-sand-50 border border-sand-200/60 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-sand-500">Quote #</span>
                <span className="font-medium text-sand-900">{lead.quote_number}</span>
              </div>
              {lead.quote_amount != null && (
                <div className="flex justify-between">
                  <span className="text-sand-500">Amount</span>
                  <span className="font-medium text-sand-900">{formatCADWhole(Number(lead.quote_amount))}</span>
                </div>
              )}
              {lead.quote_sent_at && (
                <div className="flex justify-between">
                  <span className="text-sand-500">Sent</span>
                  <span className="text-sand-700">{formatDateTime(lead.quote_sent_at)}</span>
                </div>
              )}
              {lead.assigned_to && (
                <div className="flex justify-between gap-3">
                  <span className="text-sand-500">Staff</span>
                  <span className="text-sand-700 text-right">{lead.assigned_to}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-sand-400">No quote sent yet.</p>
          )}
        </div>

        {/* Outcome */}
        <div className="px-6 py-5 space-y-3">
          <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Outcome</h4>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((o) => (
              <button
                key={o}
                onClick={() => patchLead({ outcome: o })}
                className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                  lead.outcome === o
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-sand-200 text-sand-600 hover:bg-sand-50"
                }`}
              >
                {OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
          {lead.outcome === "lost" && (
            <input
              type="text"
              defaultValue={lead.lost_reason ?? ""}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val !== (lead.lost_reason ?? "")) patchLead({ lost_reason: val || null });
              }}
              placeholder="Lost reason"
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          )}
          <textarea
            defaultValue={lead.notes ?? ""}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val !== (lead.notes ?? "")) patchLead({ notes: val || null });
            }}
            placeholder="Internal notes"
            rows={3}
            className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export default function LeadsDashboard() {
  const [filter, setFilter] = useState<string>("uncalled");
  const [sourceFilter, setSourceFilter] = useState<"all" | LeadSource>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [trendRange, setTrendRange] = useState<TrendSelection>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [chartSources, setChartSources] = useState({ website: true, meta: true });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [syncResult, setSyncResult] = useState<MetaSyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Background refresh: SWR pauses polling while the tab is hidden
  // (refreshWhenHidden defaults to false) and revalidateOnFocus catches up
  // when it becomes visible again — overriding the provider-wide opt-out.
  const autoRefreshOpts = {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    focusThrottleInterval: 30_000,
  };
  const { data, error: leadsError, isLoading } = useSWR<{ leads: Lead[] }>(
    "/api/customer-service/leads",
    fetcher,
    autoRefreshOpts
  );
  const {
    data: metaStatus,
    error: metaStatusError,
    mutate: refreshMetaStatus,
  } = useSWR<MetaStatus>("/api/customer-service/leads?view=meta_status", fetcher, autoRefreshOpts);
  const leads = useMemo(() => data?.leads ?? [], [data?.leads]);
  const { mutate } = useSWRConfig();

  const refresh = () => {
    mutate((key) => typeof key === "string" && key.startsWith("/api/customer-service/leads"));
  };

  const syncMeta = async () => {
    setSyncingMeta(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const response = await fetch("/api/customer-service/leads?action=sync_meta", {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? `Meta sync failed with status ${response.status}`);
      }
      setSyncResult(body.summary as MetaSyncSummary);
      refresh();
      await refreshMetaStatus();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Meta sync failed");
    } finally {
      setSyncingMeta(false);
    }
  };

  const sourceLeads = useMemo(
    () => sourceFilter === "all" ? leads : leads.filter((lead) => lead.source === sourceFilter),
    [leads, sourceFilter],
  );

  const filtered = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.value === filter) ?? FILTER_TABS[FILTER_TABS.length - 1];
    return sourceLeads.filter((l) => {
      if (!tab.match(l)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !(l.name ?? "").toLowerCase().includes(q) &&
          !(l.email ?? "").toLowerCase().includes(q) &&
          !(l.phone ?? "").includes(q) &&
          !(l.assigned_to ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    }).sort((a, b) => {
      const difference = new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
      return sortOrder === "newest" ? difference : -difference;
    });
  }, [sourceLeads, filter, search, sortOrder]);

  const filterCounts: Record<string, number> = useMemo(() => {
    const result: Record<string, number> = {};
    for (const tab of FILTER_TABS) {
      result[tab.value] = sourceLeads.filter((l) => tab.match(l)).length;
    }
    return result;
  }, [sourceLeads]);

  const metrics = useMemo(() => {
    const openLeads = leads.filter((l) => l.outcome !== "won" && l.outcome !== "lost");
    const uncalledLeads = openLeads.filter((l) => l.call_status === "not_called");
    const overdueUncalled = uncalledLeads.filter(
      (l) => Date.now() - new Date(l.submitted_at).getTime() >= 24 * 60 * 60 * 1000,
    ).length;
    const won = leads.filter((l) => l.outcome === "won").length;
    const lost = leads.filter((l) => l.outcome === "lost").length;
    const closed = won + lost;
    const conversion = closed > 0 ? Math.round((won / closed) * 100) : 0;
    const pipelineValue = leads
      .filter((l) => l.outcome === "quoted")
      .reduce((sum, l) => sum + Number(l.quote_amount ?? 0), 0);
    const openQuoteCount = leads.filter((l) => l.outcome === "quoted").length;
    const responseTimes = leads
      .filter((l) => l.first_call_at)
      .map((l) => new Date(l.first_call_at!).getTime() - new Date(l.submitted_at).getTime())
      .filter((duration) => duration >= 0);
    const averageResponseMs = responseTimes.length > 0
      ? responseTimes.reduce((sum, duration) => sum + duration, 0) / responseTimes.length
      : null;
    return {
      uncalled: uncalledLeads.length,
      overdueUncalled,
      won,
      lost,
      conversion,
      pipelineValue,
      openQuoteCount,
      averageResponseMs,
    };
  }, [leads]);

  const trend = useMemo(
    () => trendRange === "custom"
      ? buildCustomLeadTrend(leads, customFrom, customTo)
      : buildLeadTrend(leads, trendRange),
    [leads, trendRange, customFrom, customTo],
  );
  const trendLabel = TREND_RANGES.find((range) => range.value === trendRange)?.metricLabel ?? "period";
  const comparisonLabel = trendRange === "custom" ? "selected period" : trendLabel;
  const trendComparison = trend.previous.total === 0
    ? trend.current.total > 0 ? "No leads in the previous period" : "No leads in this period"
    : `${Math.abs(trend.changePct ?? 0)}% ${Number(trend.changePct) >= 0 ? "increase" : "decrease"} vs previous ${comparisonLabel}`;
  const sourceCounts = useMemo(() => ({
    all: leads.length,
    website: leads.filter((lead) => lead.source === "website").length,
    meta: leads.filter((lead) => lead.source === "meta").length,
  }), [leads]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  const selectTrendRange = (range: TrendSelection) => {
    if (range === "custom" && (!customFrom || !customTo)) {
      const defaults = defaultCustomDates();
      setCustomFrom(defaults.from);
      setCustomTo(defaults.to);
    }
    setTrendRange(range);
  };

  const toggleChartSource = (source: LeadSource) => {
    setChartSources((current) => {
      const other = source === "website" ? "meta" : "website";
      if (current[source] && !current[other]) return current;
      return { ...current, [source]: !current[source] };
    });
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Leads</h1>
          <p className="text-sm text-sand-500 mt-1">
            Track, contact, and convert website and Meta leads.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {metaStatus?.connected && metaStatus.subscribed && (
            <div className="flex items-center gap-2 text-xs text-sand-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{metaStatus.page_name ? `Meta: ${metaStatus.page_name}` : "Meta connected"}</span>
            </div>
          )}
          {metaStatus?.connected && metaStatus.can_sync && (
            <button
              type="button"
              onClick={syncMeta}
              disabled={syncingMeta}
              className="px-3 py-2 rounded-md border border-sand-300 bg-white text-sm font-medium text-sand-700 hover:bg-sand-50 disabled:opacity-60"
            >
              {syncingMeta ? "Syncing" : "Sync Meta"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label={`New Leads (${trendLabel})`}
          value={trend.current.total}
          color="bg-blue-500"
          subtitle={trendComparison}
        />
        <SummaryCard
          label="Need a Call"
          value={metrics.uncalled}
          color={metrics.uncalled > 0 ? "bg-amber-400" : "bg-emerald-500"}
          subtitle={metrics.overdueUncalled > 0 ? `${metrics.overdueUncalled} waiting over 24 hours` : "No overdue calls"}
        />
        <SummaryCard
          label="Quoted Pipeline"
          value={formatCADWhole(metrics.pipelineValue)}
          color="bg-indigo-500"
          subtitle={`${metrics.openQuoteCount} open quotes`}
        />
        <SummaryCard
          label="Conversion"
          value={`${metrics.conversion}%`}
          color="bg-green-500"
          subtitle={`${metrics.won} won of ${metrics.won + metrics.lost} closed`}
        />
      </div>

      <section className="bg-white border border-sand-200 rounded-lg overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-5 py-4 border-b border-sand-200">
          <div>
            <h2 className="text-base font-semibold text-sand-900">Lead volume</h2>
            <p className="text-xs text-sand-500 mt-0.5">Website and Meta submissions over time</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2 text-sand-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartSources.website}
                  disabled={chartSources.website && !chartSources.meta}
                  onChange={() => toggleChartSource("website")}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />
                Website
              </label>
              <label className="flex items-center gap-2 text-sand-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartSources.meta}
                  disabled={chartSources.meta && !chartSources.website}
                  onChange={() => toggleChartSource("meta")}
                  className="w-4 h-4 accent-pink-600"
                />
                <span className="w-2.5 h-2.5 rounded-sm bg-pink-600" />
                Meta
              </label>
            </div>
            <div className="inline-flex self-start flex-wrap rounded-md border border-sand-200 bg-sand-50 p-0.5 text-xs font-medium">
              {TREND_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={trendRange === range.value}
                  onClick={() => selectTrendRange(range.value)}
                  className={`px-3 py-1.5 rounded transition-colors ${
                    trendRange === range.value
                      ? "bg-white text-sand-900 shadow-sm"
                      : "text-sand-500 hover:text-sand-800"
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {trendRange === "custom" && (
          <div className="px-5 py-3 border-b border-sand-200 bg-sand-50 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-sand-600">
              From
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="block mt-1 px-3 py-2 rounded-md border border-sand-200 bg-white text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
            <label className="text-xs font-medium text-sand-600">
              To
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => setCustomTo(event.target.value)}
                className="block mt-1 px-3 py-2 rounded-md border border-sand-200 bg-white text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>
        )}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="h-[260px] px-3 pt-4 pb-2 sm:px-5">
            <LeadTrendChart
              data={trend.points}
              showWebsite={chartSources.website}
              showMeta={chartSources.meta}
            />
          </div>
          <div className="border-t lg:border-t-0 lg:border-l border-sand-200 px-5 py-4 flex flex-col justify-center gap-5">
            <SourceTotal label="Website" value={trend.current.website} total={trend.current.total} color="bg-blue-600" />
            <SourceTotal label="Meta" value={trend.current.meta} total={trend.current.total} color="bg-pink-600" />
            <div className="pt-4 border-t border-sand-200">
              <p className="text-xs text-sand-500">All sources</p>
              <p className="text-2xl font-semibold text-sand-900 mt-0.5">{trend.current.total}</p>
              <p className="text-xs text-sand-500 mt-1">{trendComparison}</p>
            </div>
          </div>
        </div>
      </section>

      {(metaStatusError || metaStatus?.error || syncError) && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-lg text-sm text-red-800">
          <span className="font-medium">Meta sync needs attention. </span>
          {metaStatusError?.message ?? metaStatus?.error ?? syncError}
        </div>
      )}
      {syncResult && !syncError && (
        <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 rounded-lg text-sm text-emerald-800">
          Meta sync finished: {syncResult.inserted} imported, {syncResult.deduped} already present, {syncResult.failed} failed.
        </div>
      )}

      {leadsError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-lg text-sm text-red-800">
          Could not load leads: {leadsError.message}
        </div>
      )}

      <section className="bg-white rounded-lg border border-sand-200 overflow-hidden">
        <div className="px-4 py-4 border-b border-sand-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold text-sand-900">Lead queue</h2>
              <p className="text-xs text-sand-500 mt-0.5">{filtered.length} leads in this view</p>
            </div>
            <p className="hidden sm:block text-xs text-sand-500">{formatDuration(metrics.averageResponseMs)}</p>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {FILTER_TABS.map((tab) => {
              const count = filterCounts[tab.value] ?? 0;
              const active = filter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? "text-blue-700 bg-blue-50"
                      : "text-sand-500 hover:text-sand-700 hover:bg-sand-50"
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-blue-100 text-blue-600" : "bg-sand-100 text-sand-500"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-3 border-b border-sand-200 bg-sand-50 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex self-start rounded-md border border-sand-200 bg-white p-0.5 text-xs font-medium">
            {(["all", "website", "meta"] as const).map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={sourceFilter === source}
                onClick={() => setSourceFilter(source)}
                className={`px-3 py-1.5 rounded transition-colors ${
                  sourceFilter === source ? "bg-sand-800 text-white" : "text-sand-600 hover:text-sand-900"
                }`}
              >
                {source === "all" ? "All" : SOURCE_BADGE[source].label} {sourceCounts[source]}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, or staff"
              aria-label="Search leads"
              className="w-full sm:w-64 px-3 py-2 text-sm border border-sand-200 rounded-md bg-white text-sand-700 placeholder-sand-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
              aria-label="Sort leads"
              className="px-3 py-2 text-sm border border-sand-200 rounded-md bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sand-400 text-sm">Loading leads…</div>
        ) : leadsError ? (
          <div className="py-12 text-center text-red-500 text-sm">Lead data is unavailable.</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sand-400 text-sm">
            {leads.length === 0
              ? sourceFilter === "meta"
                ? "No Meta leads have been imported yet."
                : sourceFilter === "website"
                  ? "No website leads have been received yet."
                  : "No leads have been received yet."
              : "No leads match this filter."}
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-sand-200/60">
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Lead</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Source</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Received</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Contact</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quote</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Staff</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Stage</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={`border-b border-sand-100 hover:bg-sand-50 cursor-pointer transition-colors ${
                      lead.call_status === "not_called" && lead.outcome !== "won" && lead.outcome !== "lost"
                        ? "border-l-2 border-l-amber-400"
                        : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-sand-900">{lead.name || "Unnamed"}</div>
                      <div className="text-[11px] text-sand-400 truncate max-w-[220px]">
                        {[lead.email, lead.phone].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[lead.source].className}`}>
                        {SOURCE_BADGE[lead.source].label}
                      </span>
                      {lead.source_detail && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[200px]">{lead.source_detail}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-600">
                      <div>{formatDate(lead.submitted_at)}</div>
                      <div className="text-[11px] text-sand-400">{timeAgo(lead.submitted_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${CALL_BADGE[lead.call_status]}`}>
                        {CALL_STATUS_LABELS[lead.call_status]}
                      </span>
                      {lead.last_called_by && lead.last_call_at && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[200px]">
                          {lead.last_called_by} · {timeAgo(lead.last_call_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.quote_number ? (
                        <>
                          <div className="font-medium text-sand-900">{lead.quote_number}</div>
                          {lead.quote_amount != null && (
                            <div className="text-[11px] text-sand-400">{formatCADWhole(Number(lead.quote_amount))}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-sand-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-600">
                      {lead.assigned_to ? (
                        <span className="block max-w-[160px] truncate" title={lead.assigned_to}>
                          {lead.assigned_to}
                        </span>
                      ) : (
                        <span className="text-sand-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                        {OUTCOME_LABELS[lead.outcome]}
                      </span>
                      {lead.outcome === "lost" && lead.lost_reason && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[160px]">{lead.lost_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedLeadId(lead.id); }}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        {lead.call_status === "not_called" ? "Log Call" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          onClose={() => setSelectedLeadId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, color, subtitle }: { label: string; value: string | number; color: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <p className="text-[11px] text-sand-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-semibold text-sand-900">{value}</p>
      {subtitle && <p className="text-[11px] text-sand-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function SourceTotal({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-sand-700">
          <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
          {label}
        </span>
        <span className="font-semibold text-sand-900">{value}</span>
      </div>
      <div className="mt-2 h-1.5 bg-sand-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${share}%` }} />
      </div>
      <p className="text-[11px] text-sand-400 mt-1">{share}% of leads</p>
    </div>
  );
}
