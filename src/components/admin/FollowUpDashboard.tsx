"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import SummaryCards from "@/components/admin/followup/SummaryCards";
import LeadTableImpl from "@/components/admin/followup/LeadTable";
import { type DupGroup } from "@/components/admin/followup/DuplicatesPanel";
import FollowUpModal from "@/components/admin/followup/FollowUpModal";
import CalendarViewImpl from "@/components/admin/followup/CalendarView";
import StaffBreakdownImpl from "@/components/admin/followup/StaffBreakdown";
import RecentActivityPanelImpl, { type ActivityDrillKind } from "@/components/admin/followup/RecentActivityPanel";
import { FOLLOWUP_CATEGORIES, DEFAULT_FOLLOWUP_DAYS, type LeadStatus, type FollowUpLead, type FollowUpLog } from "@/lib/followup";
import { formatCADWhole } from "@/lib/format";

// ── Chart panels: loaded via next/dynamic so recharts stays out of the
// route's initial bundle (same pattern as ShopifyCharts). memo() on top so
// the 15s SWR polls don't re-render the charts when their data is unchanged
// (SWR keeps stable references while the payload is deep-equal).
const AnalyticsChart = memo(dynamic(() => import("@/components/admin/followup/AnalyticsChart"), {
  ssr: false,
  loading: () => <div className="h-80 bg-white rounded-xl border border-sand-200/60 animate-pulse" />,
}));
const LeadStatusPanel = memo(dynamic(() => import("@/components/admin/followup/LeadStatusPanel"), {
  ssr: false,
  loading: () => <div className="h-72 bg-white rounded-xl border border-sand-200/60 animate-pulse" />,
}));
const LossReasonsPanel = memo(dynamic(() => import("@/components/admin/followup/LossReasonsPanel"), {
  ssr: false,
  loading: () => <div className="h-72 bg-white rounded-xl border border-sand-200/60 animate-pulse" />,
}));
// Fullscreen drawer — show just the backdrop while its chunk loads.
const StaffDetailPanel = dynamic(() => import("@/components/admin/followup/StaffDetailPanel"), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-black/40 z-50" />,
});

// ── Memoized heavy children. The dashboard holds ~6 polling SWR
// subscriptions; any one of them updating re-renders the whole component.
// With stable props (useMemo/useCallback below + SWR's referentially stable
// data) these skip re-rendering every table row on each poll.
const LeadTable = memo(LeadTableImpl);
const CalendarView = memo(CalendarViewImpl);
const StaffBreakdown = memo(StaffBreakdownImpl);
const RecentActivityPanel = memo(RecentActivityPanelImpl);

// Stable fallbacks so "no data yet" renders don't mint fresh array
// references on every poll (which would defeat the memo()s above).
const NO_LEADS: FollowUpLead[] = [];
const NO_GROUPS: DupGroup[] = [];
const NO_MONTHS: MonthData[] = [];

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
  avg_cycle_won: number | null;
  avg_cycle_lost: number | null;
  pipeline_value: number;
  won_value: number;
}

interface MonthData {
  month: string;
  label: string;
  total: number;
  won: number;
  lost: number;
  conversion_rate: number;
  quoted_value: number;
  won_value: number;
}

interface SummaryResponse {
  metrics: SummaryMetrics;
  by_status: Record<string, number>;
  loss_reasons: Record<string, number>;
  lead_distribution: Record<string, number>;
  last_synced_at: string | null;
  stores: { id: string; label: string; shop_domain: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Lead Detail Panel ───────────────────────────────────────────────────────

function shopifyAdminUrl(shopDomain: string, gid: string): string {
  const numericId = gid.split("/").pop() ?? gid;
  return `https://${shopDomain}/admin/draft_orders/${numericId}`;
}

function LeadDetailPanel({
  lead,
  shopDomain,
  onClose,
  onLogFollowUp,
  onRequote,
}: {
  lead: FollowUpLead;
  shopDomain: string;
  onClose: () => void;
  onLogFollowUp: () => void;
  onRequote: () => void;
}) {
  const { data: logsData } = useSWR<{ logs: FollowUpLog[] }>(
    `/api/customer-service/follow-up?view=logs&lead_id=${lead.id}`
  );
  const logs = logsData?.logs ?? [];
  const loadingLogs = !logsData;

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
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quote Details</h4>
              {shopDomain && lead.shopify_draft_id && (
                <a
                  href={shopifyAdminUrl(shopDomain, lead.shopify_draft_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                >
                  View in Shopify
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-sand-400">Amount</p>
                <p className="font-medium text-sand-900">{formatCADWhole(Number(lead.quote_amount))}</p>
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

          {/* Contributors — everyone who created or invoiced this quote */}
          {lead.contributors && lead.contributors.length > 0 && (
            <div>
              <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">
                Contributors
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {lead.contributors.map((name) => (
                  <span
                    key={name}
                    className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                      name === lead.last_invoice_sender
                        ? "bg-blue-100 text-blue-700"
                        : "bg-sand-100 text-sand-600"
                    }`}
                  >
                    {name}
                  </span>
                ))}
              </div>
              {lead.last_invoice_sender && lead.contributors.length > 1 && (
                <p className="text-[11px] text-sand-400 mt-1.5">
                  Conversion credited to <strong className="text-sand-600">{lead.last_invoice_sender}</strong> (last invoice sent).
                </p>
              )}
            </div>
          )}

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

          {/* Actions */}
          <div className="space-y-2">
            {!lead.closed_at && (
              <button
                onClick={onLogFollowUp}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Log Follow-up
              </button>
            )}
            {/* Re-Quote: refresh an existing quote (new measurements) or revive a
                lost lead that came back — resets the follow-up without making a
                new quote. */}
            <button
              onClick={onRequote}
              className="w-full py-2.5 border border-sand-300 text-sand-700 text-sm font-medium rounded-lg hover:bg-sand-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {lead.closed_at ? "Re-Quote (reopen & reset follow-up)" : "Re-Quote (reset follow-up)"}
            </button>
          </div>

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
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const configUrl = `/api/customer-service/follow-up?view=config&store=${store}`;
  const { data: configData, mutate: mutateConfig } = useSWR<{ config: Record<string, number | null> }>(
    open ? configUrl : null
  );
  const config = configData?.config ?? {};
  const loaded = !!configData;

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
      await mutateConfig({ config: configObj }, { revalidate: false });
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

export default function FollowUpDashboard({
  defaultStore,
  initialSummary,
}: {
  defaultStore?: string;
  initialSummary?: SummaryResponse | null;
}) {
  const [store, setStore] = useState(defaultStore || "store1");
  const [mounted, setMounted] = useState(false);

  const [filter, setFilter] = useState("due_today");
  // When set, the leads list is additionally filtered by this staff name.
  // Special value "__unknown__" means leads with created_by_staff = null.
  const [staffFilter, setStaffFilter] = useState<string | null>(null);
  // Click-through from the status pills (Hot Lead / New Lead / etc.). Independent
  // of staffFilter — both can be active at once.
  const [leadStatusFilter, setLeadStatusFilter] = useState<LeadStatus | null>(null);
  // Drill-down from RecentActivityPanel — restrict Addressed Today to one
  // staff member's logs, optionally narrowed by outcome bucket.
  const [addressedLoggedBy, setAddressedLoggedBy] = useState<string | null>(null);
  const [addressedOutcome, setAddressedOutcome] = useState<"won" | "lost" | "ongoing" | null>(null);
  // Which Recent Activity window the drill came from (today/yesterday/7/14/30/all),
  // so the leads shown match the follow-ups that were counted there.
  const [addressedDays, setAddressedDays] = useState<string>("today");
  // "1y" = last 12 months (default — hides legacy Unknowns where Shopify has aged out
  // the creation event). "all" = every lead ever.
  const [timeRange, setTimeRange] = useState<"1y" | "all">("1y");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  // Live auto-refresh: while on and the tab is visible, the dashboard polls the
  // DB (SWR refreshInterval) and runs a lightweight incremental Shopify sync on
  // a timer, so new quotes/wins appear without clicking "Sync from Shopify".
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Set true when an auto-sync tick fails, so we can show a subtle indicator
  // instead of the loud manual-sync error banner.
  const [autoSyncError, setAutoSyncError] = useState(false);

  // Modal / detail / help / analytics state
  const [modalLead, setModalLead] = useState<FollowUpLead | null>(null);
  const [detailLead, setDetailLead] = useState<FollowUpLead | null>(null);
  // When set, shows a right-side drawer with per-staff stats (conversion/quoted trends).
  // Mirrors `staffFilter` — "__unknown__" means leads with created_by_staff = null.
  const [detailStaff, setDetailStaff] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");

  useEffect(() => {
    const saved = localStorage.getItem("cs_followup_store");
    if (saved) setStore(saved);
    const savedRange = localStorage.getItem("cs_followup_range");
    if (savedRange === "all" || savedRange === "1y") setTimeRange(savedRange);
    const savedAuto = localStorage.getItem("cs_followup_autorefresh");
    if (savedAuto === "off") setAutoRefresh(false);
    setMounted(true);
  }, []);

  // ── Data fetching (SWR) ─────────────────────────────────────────────────────
  // Each query owns its own cache key so tab/filter changes only re-fetch what
  // actually depends on the changed input. After mutations, mutate() invalidates
  // only the affected keys (see handleLogFollowUp / handleSync / handleBulkClose).

  // When filtering by staff or by lead status, broaden the base filter to "all" so we see
  // every matching lead regardless of due date — otherwise the date filter would hide
  // leads the user explicitly clicked through to.
  const leadsFilter = (staffFilter || leadStatusFilter) ? "all" : filter;
  const creatorParam = staffFilter ? `&creator=${encodeURIComponent(staffFilter)}` : "";
  const leadStatusParam = leadStatusFilter ? `&lead_status=${leadStatusFilter}` : "";
  const rangeParam = `&range=${timeRange}`;
  // Drill params only apply on the Addressed Today tab.
  const loggedByParam =
    filter === "addressed_today" && addressedLoggedBy
      ? `&logged_by=${encodeURIComponent(addressedLoggedBy)}`
      : "";
  const outcomeParam =
    filter === "addressed_today" && addressedOutcome
      ? `&outcome=${addressedOutcome}`
      : "";
  const addressedDaysParam =
    filter === "addressed_today" && addressedLoggedBy
      ? `&addressed_days=${addressedDays}`
      : "";

  // summaryUrl is computed unconditionally (no `mounted` gate) so the server-rendered
  // HTML can use `initialSummary` as fallback data. Other URLs stay gated on mounted —
  // they don't have fallbacks and avoiding an extra fetch on hydration is cheap.
  const summaryUrl = `/api/customer-service/follow-up?view=summary&store=${store}${rangeParam}`;
  const leadsUrl = mounted && filter !== "duplicates"
    ? `/api/customer-service/follow-up?view=leads&store=${store}&filter=${leadsFilter}${creatorParam}${leadStatusParam}${loggedByParam}${outcomeParam}${addressedDaysParam}${rangeParam}`
    : null;
  // Always fetched (when mounted) so the Duplicates tab badge stays live; the
  // grouped payload is small (only emails with 2+ open quotes).
  const duplicatesUrl = mounted
    ? `/api/customer-service/follow-up?view=duplicates&store=${store}${rangeParam}`
    : null;
  const configUrl = mounted
    ? `/api/customer-service/follow-up?view=config&store=${store}`
    : null;
  const analyticsUrl = mounted
    ? `/api/customer-service/follow-up?view=analytics&store=${store}`
    : null;
  const calendarUrl = mounted
    ? `/api/customer-service/follow-up?view=leads&store=${store}&filter=all${rangeParam}`
    : null;
  const addressedTodayCountUrl = mounted
    ? `/api/customer-service/follow-up?view=addressed_today_count&store=${store}`
    : null;

  // Fallback only applies when SWR's current key matches the (defaultStore, '1y')
  // combination the server prefetched. If the user picked a different store in
  // localStorage, SWR fetches normally for the new key.
  const fallbackData =
    initialSummary && store === defaultStore && timeRange === "1y"
      ? initialSummary
      : undefined;

  // Poll the DB so the screen updates on its own while auto-refresh is on.
  // 0 disables polling (SWR convention) when the user turns auto-refresh off.
  const pollMs = mounted && autoRefresh ? 15000 : 0;
  const live = { refreshInterval: pollMs };

  const { data: summary, error: summaryError, isLoading: summaryLoading } =
    useSWR<SummaryResponse>(summaryUrl, { fallbackData, refreshInterval: pollMs });
  const { data: leadsData } = useSWR<{ leads: FollowUpLead[] }>(leadsUrl, live);
  const { data: configData } = useSWR<{ config: Record<string, number | null> }>(configUrl);
  const { data: analyticsData } = useSWR<{ months: MonthData[] }>(analyticsUrl, live);
  const { data: calendarData } = useSWR<{ leads: FollowUpLead[] }>(calendarUrl, live);
  const { data: addressedTodayCountData } = useSWR<{ count: number }>(addressedTodayCountUrl, live);
  const { data: duplicatesData, isLoading: duplicatesLoading } =
    useSWR<{ groups: DupGroup[] }>(duplicatesUrl, live);

  const stores = summary?.stores ?? [];
  const lastSyncedAt = summary?.last_synced_at ?? null;
  const leads = leadsData?.leads ?? NO_LEADS;
  const duplicateGroups = duplicatesData?.groups ?? NO_GROUPS;
  const storeDays = configData?.config ?? {};
  const analytics = analyticsData?.months ?? NO_MONTHS;
  const calendarLeads = calendarData?.leads ?? NO_LEADS;
  const loading = summaryLoading;
  const error = summaryError instanceof Error ? summaryError.message : "";

  const { mutate } = useSWRConfig();

  // Invalidate every follow-up cache key for the current store. Used after sync
  // and timing-config edits since those can touch any view.
  const invalidateAllForStore = () => {
    mutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith("/api/customer-service/follow-up") &&
        key.includes(`store=${store}`)
    );
  };

  // Invalidate just summary + leads + calendar — what changes after logging a
  // follow-up or bulk-closing leads. Analytics + config are unaffected.
  // useCallback: dependency of the useCallback'd handlers passed to the
  // memoized LeadTable below.
  const invalidateAfterLeadMutation = useCallback(() => {
    mutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith("/api/customer-service/follow-up") &&
        key.includes(`store=${store}`) &&
        (key.includes("view=summary") || key.includes("view=leads"))
    );
  }, [mutate, store]);

  // ── Live auto-refresh: incremental Shopify sync on a timer ──────────────────
  // While auto-refresh is on and the tab is visible, run the cheap "changed
  // only" sync (mode=incremental) every 30s and repaint summary + leads. The
  // SWR refreshInterval above keeps the screen fresh against the DB between
  // ticks; this is what pulls new Shopify activity into the DB. Pauses when the
  // tab is hidden and fires once immediately when it becomes visible again.
  useEffect(() => {
    if (!mounted || !autoRefresh) return;

    let cancelled = false;
    const inFlight = { current: false };

    const tick = async () => {
      if (cancelled || inFlight.current) return;
      if (document.visibilityState !== "visible") return;
      inFlight.current = true;
      try {
        const res = await fetch(
          `/api/customer-service/follow-up?store=${store}&action=sync&mode=incremental`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (res.ok) {
          setAutoSyncError(false);
          // Repaint the views the incremental sync can change.
          mutate(
            (key) =>
              typeof key === "string" &&
              key.startsWith("/api/customer-service/follow-up") &&
              key.includes(`store=${store}`) &&
              (key.includes("view=summary") || key.includes("view=leads")),
          );
        } else {
          setAutoSyncError(true);
        }
      } catch {
        if (!cancelled) setAutoSyncError(true);
      } finally {
        inFlight.current = false;
      }
    };

    const interval = setInterval(tick, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    tick(); // kick off one immediately

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mounted, autoRefresh, store, mutate]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus("");
    try {
      const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=sync`, { method: "POST" });
      // When the function times out, Vercel returns an HTML error page —
      // res.json() would throw "Unexpected token 'A'". Read as text first
      // so the user sees a real status code instead of a parser error.
      const text = await res.text();
      let json: { status?: string; error?: string; new_leads?: number; updated_leads?: number; auto_won?: number; stale_detected?: number; errors?: number; first_error?: string; lead_quote_sync?: { linked?: number; errors?: number; firstError?: string | null } };
      try {
        json = JSON.parse(text);
      } catch {
        setSyncStatus(`Sync failed (HTTP ${res.status}). ${res.status === 504 || res.status === 502 ? "Function timed out — try again or check Vercel logs." : "Server returned a non-JSON response."}`);
        return;
      }
      if (json.status === "success") {
        const newLeads = json.new_leads ?? 0;
        const updatedLeads = json.updated_leads ?? 0;
        const autoWon = json.auto_won ?? 0;
        const staleDetected = json.stale_detected ?? 0;
        const errors = json.errors ?? 0;
        const linkedLeads = json.lead_quote_sync?.linked ?? 0;
        const quoteSyncErrors = json.lead_quote_sync?.errors ?? 0;
        const parts: string[] = [];
        if (newLeads > 0) parts.push(`${newLeads} new`);
        if (updatedLeads > 0) parts.push(`${updatedLeads} updated`);
        if (autoWon > 0) parts.push(`${autoWon} auto-won`);
        if (staleDetected > 0) parts.push(`${staleDetected} stale`);
        if (linkedLeads > 0) parts.push(`${linkedLeads} leads linked to quotes`);
        const base = parts.length > 0 ? `Synced: ${parts.join(", ")}` : "Already up to date";
        if (errors > 0 || quoteSyncErrors > 0) {
          const totalErrors = errors + quoteSyncErrors;
          const firstError = json.first_error ?? json.lead_quote_sync?.firstError;
          const detail = firstError ? `, first: ${firstError}` : "";
          setSyncStatus(`${base} (${totalErrors} write errors${detail})`);
        } else {
          setSyncStatus(base);
        }
        invalidateAllForStore();
      } else {
        setSyncStatus(`Error: ${json.error ?? "Unknown"}`);
      }
    } catch (e) {
      setSyncStatus(`Failed to sync: ${e instanceof Error ? e.message : String(e)}`);
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
    invalidateAfterLeadMutation();
  };

  // Re-Quote: reset the follow-up for an existing quote (new measurements) or
  // revive a lost lead that came back — without creating a new quote.
  const handleRequote = async (lead: FollowUpLead) => {
    const verb = lead.closed_at ? "reopen this lead and reset its follow-up" : "reset the follow-up for this quote";
    if (!window.confirm(`Re-quote ${lead.draft_name}? This will ${verb}, re-date it, and reschedule the first follow-up.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=requote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.error);
      setDetailLead(null);
      invalidateAfterLeadMutation();
    } catch (e) {
      alert(`Re-quote failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleBulkClose = useCallback(async (leadIds: string[], reason: string) => {
    const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=bulk_close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: leadIds, status: "lost", close_reason: reason }),
    });
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.error);
    invalidateAfterLeadMutation();
  }, [store, invalidateAfterLeadMutation]);

  // Invalidate summary + leads + the duplicates group list. Used after
  // resolving/dismissing a duplicate group so the tab badge and list refresh.
  const invalidateAfterDuplicateMutation = useCallback(() => {
    mutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith("/api/customer-service/follow-up") &&
        key.includes(`store=${store}`) &&
        (key.includes("view=summary") || key.includes("view=leads") || key.includes("view=duplicates")),
    );
  }, [mutate, store]);

  // Duplicates tab: keep the newest quote, close the rest as duplicate.
  const handleResolveDuplicates = useCallback(async (group: DupGroup) => {
    const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=resolve_duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: group.leads.map((l) => l.id) }),
    });
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.error);
    invalidateAfterDuplicateMutation();
  }, [store, invalidateAfterDuplicateMutation]);

  // Duplicates tab: mark the group as genuinely-separate orders (not a dup).
  const handleDismissDuplicates = useCallback(async (group: DupGroup) => {
    const res = await fetch(`/api/customer-service/follow-up?store=${store}&action=dismiss_duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: group.leads.map((l) => l.id) }),
    });
    const json = await res.json();
    if (json.status !== "success") throw new Error(json.error);
    invalidateAfterDuplicateMutation();
  }, [store, invalidateAfterDuplicateMutation]);

  // ── Stable callbacks for the memoized children (LeadTable / CalendarView /
  // StaffBreakdown / RecentActivityPanel). Only touch state setters, so the
  // references never change.

  const handleFilterChange = useCallback((f: string) => {
    setFilter(f);
    // Tab change clears the Recent Activity drill — the drill only makes
    // sense within Addressed Today.
    if (f !== "addressed_today") {
      setAddressedLoggedBy(null);
      setAddressedOutcome(null);
    }
  }, []);

  const handleStaffClick = useCallback((s: string) => {
    // Clicking "Unknown" maps to leads with no creator attribution.
    const key = s === "Unknown" ? "__unknown__" : s;
    setStaffFilter(key);
    setDetailStaff(key);
    // Scroll to the lead table so the user sees the filtered results.
    requestAnimationFrame(() => {
      document.getElementById("followup-lead-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const handleActivityDrillDown = useCallback((loggedBy: string, kind: ActivityDrillKind, days: string) => {
    setFilter("addressed_today");
    setAddressedLoggedBy(loggedBy);
    setAddressedOutcome(kind === "all" ? null : kind);
    setAddressedDays(days);
    // These supersede the existing creator / status drills.
    setStaffFilter(null);
    setLeadStatusFilter(null);
    // Scroll the lead list into view so the user sees the result.
    setTimeout(() => {
      document.getElementById("followup-lead-list")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }, []);

  const openLogModal = useCallback((lead: FollowUpLead) => setModalLead(lead), []);
  const openDetail = useCallback((lead: FollowUpLead) => setDetailLead(lead), []);

  const handleStoreChange = (newStore: string) => {
    setStore(newStore);
    localStorage.setItem("cs_followup_store", newStore);
  };

  // Build filter counts from summary
  // "Due Today" tab now bundles today + overdue so the count matches what the
  // list actually shows. The Summary card metric stays today-only — it's a KPI,
  // not a workload tally.
  // useMemo: keeps the object reference stable across SWR polls so the
  // memoized LeadTable doesn't re-render every row on each poll.
  const filterCounts: Record<string, number> = useMemo(() => ({
    due_today: (summary?.metrics.due_today ?? 0) + (summary?.metrics.overdue ?? 0),
    overdue: summary?.metrics.overdue ?? 0,
    upcoming: Math.max(0, (summary?.metrics.total_active ?? 0) - (summary?.metrics.due_today ?? 0) - (summary?.metrics.overdue ?? 0)),
    addressed_today: addressedTodayCountData?.count ?? 0,
    all: summary?.metrics.total_active ?? 0,
    closed: summary?.metrics.total_closed ?? 0,
    // "All" = active + closed in one list.
    everything: (summary?.metrics.total_active ?? 0) + (summary?.metrics.total_closed ?? 0),
    // Number of customers (email groups) with 2+ open quotes still to review.
    duplicates: duplicateGroups.length,
  }), [summary, addressedTodayCountData, duplicateGroups]);

  const metrics = summary?.metrics;

  // Status pills for active statuses — derived once per summary change
  // instead of re-filtering/sorting on every poll re-render.
  const statusPills = useMemo(
    () =>
      Object.entries(summary?.by_status ?? {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]),
    [summary],
  );

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
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/customer-service/follow-up?test=1"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
            title="Practice follow-ups on 10 fake leads — no real data is touched"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Test Mode
          </Link>
          <div className="inline-flex rounded-lg border border-sand-200 bg-white p-0.5 text-xs font-medium">
            <button
              onClick={() => {
                setTimeRange("1y");
                localStorage.setItem("cs_followup_range", "1y");
              }}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                timeRange === "1y"
                  ? "bg-blue-600 text-white"
                  : "text-sand-600 hover:text-sand-900"
              }`}
            >
              Last 12 months
            </button>
            <button
              onClick={() => {
                setTimeRange("all");
                localStorage.setItem("cs_followup_range", "all");
              }}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                timeRange === "all"
                  ? "bg-blue-600 text-white"
                  : "text-sand-600 hover:text-sand-900"
              }`}
            >
              All time
            </button>
          </div>
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
          {lastSyncedAt && (
            <p className="text-[11px] text-sand-400" title={new Date(lastSyncedAt).toLocaleString()}>
              Last synced {formatDate(lastSyncedAt)}
            </p>
          )}
          {/* Live auto-refresh toggle — when on, the board pulls fresh Shopify
              activity on a timer without clicking Sync. */}
          <button
            onClick={() => {
              const next = !autoRefresh;
              setAutoRefresh(next);
              localStorage.setItem("cs_followup_autorefresh", next ? "on" : "off");
              if (!next) setAutoSyncError(false);
            }}
            title={
              autoRefresh
                ? autoSyncError
                  ? "Auto-refresh is on but the last update failed — click to turn off"
                  : "Auto-refresh is on — updating from Shopify automatically"
                : "Auto-refresh is off — click to turn on"
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              autoRefresh
                ? autoSyncError
                  ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                  : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                : "bg-white text-sand-500 border-sand-200 hover:bg-sand-50"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                autoRefresh
                  ? autoSyncError
                    ? "bg-amber-500"
                    : "bg-green-500 animate-pulse"
                  : "bg-sand-300"
              }`}
            />
            {autoRefresh ? "Live" : "Live off"}
          </button>
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
                subtitle: `${formatCADWhole(metrics.pipeline_value)} pipeline`,
              },
              {
                label: "Conversion Rate",
                value: `${metrics.conversion_rate}%`,
                color: "bg-green-500",
                subtitle: `${metrics.won_count} won / ${metrics.won_count + metrics.lost_count} closed`,
              },
            ]}
          />

          {/* Cycle time cards */}
          {(metrics.avg_cycle_won !== null || metrics.avg_cycle_lost !== null) && (
            <SummaryCards
              cards={[
                {
                  label: "Avg Cycle (Won)",
                  value: metrics.avg_cycle_won !== null ? `${metrics.avg_cycle_won}d` : "—",
                  color: "bg-green-400",
                  subtitle: "Quote to conversion",
                },
                {
                  label: "Avg Cycle (Lost)",
                  value: metrics.avg_cycle_lost !== null ? `${metrics.avg_cycle_lost}d` : "—",
                  color: "bg-slate-400",
                  subtitle: "Quote to close",
                },
                {
                  label: "Avg Attempts",
                  value: metrics.avg_attempts,
                  color: "bg-indigo-400",
                  subtitle: "Follow-ups per lead",
                },
                {
                  label: "Pipeline Value",
                  value: formatCADWhole(metrics.pipeline_value),
                  color: "bg-emerald-500",
                  subtitle: `${metrics.total_active} open quotes`,
                },
              ]}
            />
          )}

          {/* Analytics Chart */}
          <AnalyticsChart data={analytics} />

          {/* Status breakdown pills — click to filter the lead table */}
          {statusPills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {statusPills.map(([status, count]) => {
                const label = FOLLOWUP_CATEGORIES[status as LeadStatus]?.label ?? status;
                const color = STATUS_PILL_COLORS[status] ?? "bg-sand-100 text-sand-600";
                const active = leadStatusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setLeadStatusFilter((prev) => (prev === status ? null : (status as LeadStatus)));
                      requestAnimationFrame(() => {
                        document.getElementById("followup-lead-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      });
                    }}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer transition-all hover:brightness-95 ${color} ${
                      active ? "ring-2 ring-offset-1 ring-current" : ""
                    }`}
                  >
                    {label}
                    <span className="font-semibold">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Per-staff breakdown */}
          <StaffBreakdown
            store={store}
            range={timeRange}
            onStaffClick={handleStaffClick}
          />

          {/* Recent follow-up activity by staff */}
          <RecentActivityPanel
            store={store}
            onDrillDown={handleActivityDrillDown}
          />

          {/* Active staff filter chip */}
          {staffFilter && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
              <span className="text-sm text-blue-700">
                Showing leads by <strong>{staffFilter === "__unknown__" ? "Unknown" : staffFilter}</strong>
              </span>
              <button
                onClick={() => { setStaffFilter(null); setDetailStaff(null); }}
                className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Active "Addressed Today by staff" drill-down chip */}
          {filter === "addressed_today" && addressedLoggedBy && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <span className="text-sm text-emerald-800">
                {addressedDays === "today"
                  ? "Today's"
                  : addressedDays === "yesterday"
                  ? "Yesterday's"
                  : addressedDays === "all"
                  ? "All-time"
                  : `Last ${addressedDays} days'`}
                {addressedOutcome === "won" && " won"}
                {addressedOutcome === "lost" && " lost"}
                {addressedOutcome === "ongoing" && " open"}
                {" "}follow-ups by <strong>{addressedLoggedBy}</strong>
              </span>
              <button
                onClick={() => { setAddressedLoggedBy(null); setAddressedOutcome(null); }}
                className="ml-auto text-xs text-emerald-700 hover:text-emerald-900 font-medium"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Active lead-status filter chip */}
          {leadStatusFilter && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <span className="text-sm text-amber-800">
                Showing leads with status:{" "}
                <strong>{FOLLOWUP_CATEGORIES[leadStatusFilter]?.label ?? leadStatusFilter}</strong>
              </span>
              <button
                onClick={() => setLeadStatusFilter(null)}
                className="ml-auto text-xs text-amber-700 hover:text-amber-900 font-medium"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                viewMode === "table" ? "bg-blue-600 text-white" : "bg-sand-100 text-sand-600 hover:bg-sand-200"
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                viewMode === "calendar" ? "bg-blue-600 text-white" : "bg-sand-100 text-sand-600 hover:bg-sand-200"
              }`}
            >
              Calendar
            </button>
          </div>

          {/* Lead Table or Calendar */}
          <div id="followup-lead-list">
          {viewMode === "calendar" ? (
            <CalendarView
              leads={calendarLeads}
              onViewDetail={openDetail}
            />
          ) : (
          <LeadTable
            leads={leads}
            filter={filter}
            onFilterChange={handleFilterChange}
            onLogFollowUp={openLogModal}
            onViewDetail={openDetail}
            onBulkClose={handleBulkClose}
            filterCounts={filterCounts}
            duplicateGroups={duplicateGroups}
            duplicatesLoading={duplicatesLoading}
            onResolveDuplicates={handleResolveDuplicates}
            onDismissDuplicates={handleDismissDuplicates}
          />
          )}
          </div>

          {/* Lead status + Loss reasons — two pie panels side by side */}
          {((summary?.lead_distribution && Object.keys(summary.lead_distribution).length > 0) ||
            (summary?.loss_reasons && Object.keys(summary.loss_reasons).length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {summary?.lead_distribution && Object.keys(summary.lead_distribution).length > 0 && (
                <LeadStatusPanel distribution={summary.lead_distribution} />
              )}
              {summary?.loss_reasons && Object.keys(summary.loss_reasons).length > 0 && (
                <LossReasonsPanel reasons={summary.loss_reasons} store={store} range={timeRange} />
              )}
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
          shopDomain={stores.find((s) => s.id === store)?.shop_domain ?? ""}
          onClose={() => setDetailLead(null)}
          onLogFollowUp={() => {
            setModalLead(detailLead);
            setDetailLead(null);
          }}
          onRequote={() => handleRequote(detailLead)}
        />
      )}

      {/* Staff Detail Panel (stats drawer) */}
      {detailStaff && (
        <StaffDetailPanel
          staff={detailStaff}
          store={store}
          range={timeRange}
          onClose={() => setDetailStaff(null)}
        />
      )}
    </>
  );
}
