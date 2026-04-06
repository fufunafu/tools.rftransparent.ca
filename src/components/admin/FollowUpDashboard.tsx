"use client";

import { useState, useEffect, useCallback } from "react";
import SummaryCards from "@/components/admin/followup/SummaryCards";
import LeadTable from "@/components/admin/followup/LeadTable";
import FollowUpModal from "@/components/admin/followup/FollowUpModal";
import { FOLLOWUP_CATEGORIES, DEFAULT_FOLLOWUP_DAYS, type LeadStatus, type FollowUpLead, type FollowUpLog } from "@/lib/followup";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SummaryMetrics {
  due_today: number;
  overdue: number;
  total_active: number;
  total_closed: number;
  won_count: number;
  lost_count: number;
  conversion_rate: number;
  avg_attempts: number;
  pipeline_value: number;
  won_value: number;
}

interface SummaryResponse {
  metrics: SummaryMetrics;
  by_status: Record<string, number>;
  loss_reasons: Record<string, number>;
  stores: { id: string; label: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Lead Detail Panel ───────────────────────────────────────────────────────

function LeadDetailPanel({
  lead,
  onClose,
  onLogFollowUp,
}: {
  lead: FollowUpLead;
  onClose: () => void;
  onLogFollowUp: () => void;
}) {
  const [logs, setLogs] = useState<FollowUpLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  useEffect(() => {
    setLoadingLogs(true);
    fetch(`/api/customer-service/follow-up?view=logs&lead_id=${lead.id}`)
      .then((r) => r.json())
      .then((d) => setLogs(d.logs ?? []))
      .finally(() => setLoadingLogs(false));
  }, [lead.id]);

  const statusLabel = FOLLOWUP_CATEGORIES[lead.lead_status as LeadStatus]?.label ?? lead.lead_status;

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-sand-200/60 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold text-sand-900">{lead.draft_name}</h3>
          <button onClick={onClose} className="text-sand-400 hover:text-sand-600 p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Customer Info */}
          <div>
            <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">Customer</h4>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-sand-900">{lead.customer_name || "Unknown"}</p>
              {lead.customer_email && (
                <a href={`mailto:${lead.customer_email}`} className="block text-sm text-blue-600 hover:underline">
                  {lead.customer_email}
                </a>
              )}
              {lead.customer_phone && (
                <a href={`tel:${lead.customer_phone}`} className="block text-sm text-blue-600 hover:underline">
                  {lead.customer_phone}
                </a>
              )}
            </div>
          </div>

          {/* Draft Details */}
          <div>
            <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">Quote Details</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-sand-400">Amount</p>
                <p className="font-medium text-sand-900">{formatCurrency(Number(lead.quote_amount))}</p>
              </div>
              <div>
                <p className="text-sand-400">Shopify Status</p>
                <p className="font-medium text-sand-900">{lead.shopify_status}</p>
              </div>
              <div>
                <p className="text-sand-400">Lead Status</p>
                <p className="font-medium text-sand-900">{statusLabel}</p>
              </div>
              <div>
                <p className="text-sand-400">Follow-ups</p>
                <p className="font-medium text-sand-900">{lead.followup_count}</p>
              </div>
              <div>
                <p className="text-sand-400">Created</p>
                <p className="font-medium text-sand-900">{formatDate(lead.created_at)}</p>
              </div>
              {lead.closed_at && (
                <div>
                  <p className="text-sand-400">Closed</p>
                  <p className="font-medium text-sand-900">{formatDate(lead.closed_at)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Close reason */}
          {lead.close_reason && (
            <div>
              <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">Loss Reason</h4>
              <p className="text-sm text-sand-700">{lead.close_reason}</p>
            </div>
          )}

          {/* Notes */}
          {lead.notes && (
            <div>
              <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">Notes</h4>
              <p className="text-sm text-sand-700 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}

          {/* Action */}
          {!lead.closed_at && (
            <button
              onClick={onLogFollowUp}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Log Follow-up
            </button>
          )}

          {/* Follow-up Timeline */}
          <div>
            <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-3">Follow-up History</h4>
            {loadingLogs ? (
              <p className="text-sm text-sand-400">Loading...</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-sand-400">No follow-ups recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => {
                  const outcomeLabel = FOLLOWUP_CATEGORIES[log.outcome as LeadStatus]?.label ?? log.outcome;
                  return (
                    <div key={log.id} className="relative pl-5 border-l-2 border-sand-200 pb-2">
                      <div className="absolute -left-1.5 top-0.5 w-3 h-3 rounded-full bg-sand-300" />
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-sand-900">{outcomeLabel}</span>
                        <span className="text-[11px] text-sand-400">{formatDate(log.created_at)}</span>
                      </div>
                      {log.notes && (
                        <p className="text-sm text-sand-600">{log.notes}</p>
                      )}
                      <p className="text-[11px] text-sand-400 mt-0.5">by {log.logged_by}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Timing Editor ───────────────────────────────────────────────────────────

const EDITABLE_CATEGORIES = ["new", "hot_lead", "considering", "price_shopping", "no_answer"] as const;

function TimingEditor({ store }: { store: string }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Record<string, number | null>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/customer-service/follow-up?view=config&store=${store}`)
      .then((r) => r.json())
      .then((d) => { setConfig(d.config ?? {}); setLoaded(true); });
  }, [open, store]);

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const cat of EDITABLE_CATEGORIES) {
      d[cat] = String(config[cat] ?? DEFAULT_FOLLOWUP_DAYS[cat] ?? "");
    }
    setDraft(d);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const configObj: Record<string, number | null> = {};
      for (const cat of EDITABLE_CATEGORIES) {
        const val = parseInt(draft[cat]);
        configObj[cat] = isNaN(val) ? null : val;
      }
      const res = await fetch("/api/customer-service/follow-up", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: store, config: configObj }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setConfig(configObj);
      setEditing(false);
    } catch {
      alert("Failed to save timing config");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-sand-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-sand-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          <span className="text-sm font-medium text-sand-700">Follow-up Timing Settings</span>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-sand-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-sand-200/60 pt-4">
          {!loaded ? (
            <p className="text-sm text-sand-400">Loading...</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-sand-500">Days until next follow-up for each category. &ldquo;Future Project&rdquo; always uses a custom date.</p>
                {!editing ? (
                  <button onClick={startEdit} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(false)} className="text-xs text-sand-400 hover:text-sand-600">Cancel</button>
                    <button onClick={handleSave} disabled={saving} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1 rounded-md disabled:opacity-50">
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {EDITABLE_CATEGORIES.map((cat) => {
                  const label = FOLLOWUP_CATEGORIES[cat]?.label ?? cat;
                  const currentDays = config[cat] ?? DEFAULT_FOLLOWUP_DAYS[cat];
                  return (
                    <div key={cat} className="text-center">
                      <p className="text-xs text-sand-500 mb-1">{label}</p>
                      {editing ? (
                        <input
                          type="number"
                          min="1"
                          value={draft[cat] ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [cat]: e.target.value }))}
                          className="w-16 mx-auto px-2 py-1 text-center text-sm border border-sand-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      ) : (
                        <p className="text-lg font-semibold text-sand-900">{currentDays ?? "—"}<span className="text-xs font-normal text-sand-400 ml-0.5">d</span></p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function FollowUpDashboard({ defaultStore }: { defaultStore?: string }) {
  const [store, setStore] = useState(defaultStore || "store1");
  const [stores, setStores] = useState<{ id: string; label: string }[]>([]);
  const [mounted, setMounted] = useState(false);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [leads, setLeads] = useState<FollowUpLead[]>([]);
  const [filter, setFilter] = useState("due_today");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [error, setError] = useState("");

  // Modal / detail / help / config state
  const [modalLead, setModalLead] = useState<FollowUpLead | null>(null);
  const [detailLead, setDetailLead] = useState<FollowUpLead | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [storeDays, setStoreDays] = useState<Record<string, number | null>>({});

  useEffect(() => {
    const saved = localStorage.getItem("cs_followup_store");
    if (saved) setStore(saved);
    setMounted(true);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, leadsRes, configRes] = await Promise.all([
        fetch(`/api/customer-service/follow-up?view=summary&store=${store}`),
        fetch(`/api/customer-service/follow-up?view=leads&store=${store}&filter=${filter}`),
        fetch(`/api/customer-service/follow-up?view=config&store=${store}`),
      ]);

      if (!summaryRes.ok) throw new Error("Failed to load follow-up data");

      const summaryData = await summaryRes.json();
      const leadsData = await leadsRes.json();
      const configData = await configRes.json();

      setSummary(summaryData);
      setStores(summaryData.stores ?? []);
      setLeads(leadsData.leads ?? []);
      setStoreDays(configData.config ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [store, filter]);

  useEffect(() => { if (mounted) loadData(); }, [loadData, mounted]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus("");
    try {
      const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=sync`, { method: "POST" });
      const json = await res.json();
      if (json.status === "success") {
        const parts: string[] = [];
        if (json.new_leads > 0) parts.push(`${json.new_leads} new`);
        if (json.updated_leads > 0) parts.push(`${json.updated_leads} updated`);
        if (json.auto_won > 0) parts.push(`${json.auto_won} auto-won`);
        if (json.stale_detected > 0) parts.push(`${json.stale_detected} stale`);
        setSyncStatus(parts.length > 0 ? `Synced: ${parts.join(", ")}` : "Already up to date");
        loadData();
      } else {
        setSyncStatus(`Error: ${json.error}`);
      }
    } catch {
      setSyncStatus("Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleLogFollowUp = async (data: {
    lead_id: string;
    outcome: LeadStatus;
    notes?: string;
    close_reason?: string;
    custom_date?: string;
  }) => {
    const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.error);
    setModalLead(null);
    loadData();
  };

  const handleStoreChange = (newStore: string) => {
    setStore(newStore);
    localStorage.setItem("cs_followup_store", newStore);
  };

  // Build filter counts from summary
  const filterCounts: Record<string, number> = {
    due_today: summary?.metrics.due_today ?? 0,
    overdue: summary?.metrics.overdue ?? 0,
    upcoming: Math.max(0, (summary?.metrics.total_active ?? 0) - (summary?.metrics.due_today ?? 0) - (summary?.metrics.overdue ?? 0)),
    all: summary?.metrics.total_active ?? 0,
    closed: summary?.metrics.total_closed ?? 0,
  };

  const metrics = summary?.metrics;
  const byStatus = summary?.by_status ?? {};

  // Status pills for active statuses
  const statusPills = Object.entries(byStatus)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const STATUS_PILL_COLORS: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    hot_lead: "bg-red-100 text-red-700",
    considering: "bg-amber-100 text-amber-700",
    price_shopping: "bg-orange-100 text-orange-700",
    future_project: "bg-purple-100 text-purple-700",
    no_answer: "bg-gray-100 text-gray-600",
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-sand-900">Follow-up CRM</h1>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="w-5 h-5 rounded-full bg-sand-200 text-sand-500 hover:bg-blue-100 hover:text-blue-600 text-xs font-bold flex items-center justify-center transition-colors"
              title="How does this work?"
            >
              ?
            </button>
          </div>
          <p className="text-sm text-sand-500 mt-1">Track quotes and schedule follow-up calls to improve conversion</p>

          {/* Help popover */}
          {showHelp && (
            <div className="absolute top-full left-0 mt-2 w-[420px] bg-white rounded-xl border border-sand-200 shadow-lg p-5 z-30 text-sm text-sand-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sand-900">How it works</h3>
                <button onClick={() => setShowHelp(false)} className="text-sand-400 hover:text-sand-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <ol className="list-decimal list-inside space-y-2">
                <li><strong>Sync</strong> &mdash; Click &ldquo;Sync from Shopify&rdquo; to pull in all open quotes (draft orders).</li>
                <li><strong>First follow-up</strong> &mdash; New quotes are automatically scheduled for a follow-up call in 3 days.</li>
                <li><strong>Call &amp; categorize</strong> &mdash; After calling the customer, click &ldquo;Log Follow-up&rdquo; and pick a category. The next follow-up is scheduled automatically.</li>
                <li><strong>Repeat</strong> &mdash; Keep following up until the lead converts or is closed.</li>
              </ol>

              <div>
                <p className="font-medium text-sand-900 mb-1">Categories &amp; timing:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                  <span>Hot Lead</span><span className="text-sand-500">next day</span>
                  <span>No Answer</span><span className="text-sand-500">2 days</span>
                  <span>Price Shopping</span><span className="text-sand-500">4 days</span>
                  <span>Considering</span><span className="text-sand-500">7 days</span>
                  <span>Future Project</span><span className="text-sand-500">custom date</span>
                </div>
              </div>

              <div className="text-xs text-sand-500 border-t border-sand-100 pt-2 space-y-1">
                <p>After <strong>5 attempts</strong> without conversion, the system suggests closing the lead.</p>
                <p>When a quote is marked as <strong>Lost</strong>, you must select a reason (for trending).</p>
                <p>Quotes that convert in Shopify are automatically marked as <strong>Won</strong>.</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {stores.length > 1 && (
            <select
              value={store}
              onChange={(e) => handleStoreChange(e.target.value)}
              className="text-sm border border-sand-200 rounded-lg px-3 py-2 bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              syncing
                ? "bg-sand-200 text-sand-400 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {syncing ? "Syncing..." : "Sync from Shopify"}
          </button>
        </div>
      </div>

      {/* Sync progress */}
      {syncing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <svg className="w-4 h-4 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-700">Pulling draft orders from Shopify...</p>
            <p className="text-xs text-blue-600">This can take 30-60 seconds. Syncing all quotes from Shopify.</p>
          </div>
        </div>
      )}

      {/* Sync status */}
      {syncStatus && (
        <div className={`text-sm px-4 py-2 rounded-lg ${
          syncStatus.startsWith("Error") || syncStatus.startsWith("Failed")
            ? "bg-red-50 text-red-700"
            : "bg-green-50 text-green-700"
        }`}>
          {syncStatus}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-sand-200/60 p-4 animate-pulse">
              <div className="h-3 w-20 bg-sand-200 rounded mb-3" />
              <div className="h-6 w-12 bg-sand-200 rounded" />
            </div>
          ))}
        </div>
      ) : metrics ? (
        <>
          {/* Summary Cards */}
          <SummaryCards
            cards={[
              {
                label: "Due Today",
                value: metrics.due_today,
                color: metrics.due_today > 0 ? "bg-amber-400" : "bg-sand-300",
                subtitle: metrics.due_today > 0 ? "Follow-ups needed" : "All clear",
              },
              {
                label: "Overdue",
                value: metrics.overdue,
                color: metrics.overdue > 0 ? "bg-red-500" : "bg-sand-300",
                subtitle: metrics.overdue > 0 ? "Needs attention" : "None overdue",
              },
              {
                label: "Active Leads",
                value: metrics.total_active,
                color: "bg-blue-500",
                subtitle: `${formatCurrency(metrics.pipeline_value)} pipeline`,
              },
              {
                label: "Conversion Rate",
                value: `${metrics.conversion_rate}%`,
                color: "bg-green-500",
                subtitle: `${metrics.won_count} won / ${metrics.won_count + metrics.lost_count} closed`,
              },
            ]}
          />

          {/* Status breakdown pills */}
          {statusPills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {statusPills.map(([status, count]) => {
                const label = FOLLOWUP_CATEGORIES[status as LeadStatus]?.label ?? status;
                const color = STATUS_PILL_COLORS[status] ?? "bg-sand-100 text-sand-600";
                return (
                  <span key={status} className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${color}`}>
                    {label}
                    <span className="font-semibold">{count}</span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Lead Table */}
          <LeadTable
            leads={leads}
            filter={filter}
            onFilterChange={(f) => setFilter(f)}
            onLogFollowUp={(lead) => setModalLead(lead)}
            onViewDetail={(lead) => setDetailLead(lead)}
            filterCounts={filterCounts}
          />

          {/* Loss reasons summary */}
          {summary?.loss_reasons && Object.keys(summary.loss_reasons).length > 0 && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-5">
              <h3 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-3">Loss Reasons</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Object.entries(summary.loss_reasons)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, count]) => (
                    <div key={reason} className="text-center">
                      <p className="text-lg font-semibold text-sand-900">{count}</p>
                      <p className="text-xs text-sand-500">{reason}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Follow-up timing editor */}
          <TimingEditor store={store} />
        </>
      ) : null}

      {/* Follow-up Modal */}
      {modalLead && (
        <FollowUpModal
          lead={modalLead}
          storeDays={storeDays}
          onClose={() => setModalLead(null)}
          onSubmit={handleLogFollowUp}
        />
      )}

      {/* Lead Detail Panel */}
      {detailLead && (
        <LeadDetailPanel
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onLogFollowUp={() => {
            setModalLead(detailLead);
            setDetailLead(null);
          }}
        />
      )}
    </>
  );
}
