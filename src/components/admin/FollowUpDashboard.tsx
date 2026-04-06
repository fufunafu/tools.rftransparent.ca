"use client";

import { useState, useEffect, useCallback } from "react";
import SummaryCards from "@/components/admin/followup/SummaryCards";
import LeadTable from "@/components/admin/followup/LeadTable";
import FollowUpModal from "@/components/admin/followup/FollowUpModal";
import { FOLLOWUP_CATEGORIES, type LeadStatus, type FollowUpLead, type FollowUpLog } from "@/lib/followup";

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

  // Modal / detail state
  const [modalLead, setModalLead] = useState<FollowUpLead | null>(null);
  const [detailLead, setDetailLead] = useState<FollowUpLead | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("cs_followup_store");
    if (saved) setStore(saved);
    setMounted(true);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, leadsRes] = await Promise.all([
        fetch(`/api/customer-service/follow-up?view=summary&store=${store}`),
        fetch(`/api/customer-service/follow-up?view=leads&store=${store}&filter=${filter}`),
      ]);

      if (!summaryRes.ok) throw new Error("Failed to load follow-up data");

      const summaryData = await summaryRes.json();
      const leadsData = await leadsRes.json();

      setSummary(summaryData);
      setStores(summaryData.stores ?? []);
      setLeads(leadsData.leads ?? []);
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
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Follow-up CRM</h1>
          <p className="text-sm text-sand-500 mt-1">Track quotes and schedule follow-up calls to improve conversion</p>
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
        </>
      ) : null}

      {/* Follow-up Modal */}
      {modalLead && (
        <FollowUpModal
          lead={modalLead}
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
