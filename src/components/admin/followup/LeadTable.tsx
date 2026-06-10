"use client";

import { useState, useMemo } from "react";
import { FOLLOWUP_CATEGORIES, MAX_ATTEMPTS, LOSS_REASONS, type LeadStatus } from "@/lib/followup";
import type { FollowUpLead } from "@/lib/followup";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  hot_lead: "bg-red-100 text-red-700",
  considering: "bg-amber-100 text-amber-700",
  price_shopping: "bg-orange-100 text-orange-700",
  future_project: "bg-purple-100 text-purple-700",
  no_answer: "bg-gray-100 text-gray-600",
  lost: "bg-slate-100 text-slate-500",
  duplicate: "bg-slate-100 text-slate-500",
  won: "bg-green-100 text-green-700",
};

function formatDueDate(iso: string | null): { text: string; className: string } {
  if (!iso) return { text: "—", className: "text-sand-400" };
  const now = new Date();
  const due = new Date(iso);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return { text: absDays === 1 ? "1 day ago" : `${absDays} days ago`, className: "text-red-600 font-medium" };
  }
  if (diffDays === 0) return { text: "Today", className: "text-amber-600 font-medium" };
  if (diffDays === 1) return { text: "Tomorrow", className: "text-green-600" };
  return { text: `In ${diffDays} days`, className: "text-sand-500" };
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  leads: FollowUpLead[];
  filter: string;
  onFilterChange: (f: string) => void;
  onLogFollowUp: (lead: FollowUpLead) => void;
  onViewDetail: (lead: FollowUpLead) => void;
  onBulkClose: (leadIds: string[], reason: string) => Promise<void>;
  filterCounts: Record<string, number>;
}

const FILTER_TABS = [
  { value: "due_today", label: "Due Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "addressed_today", label: "Addressed Today" },
  { value: "all", label: "All Active" },
  { value: "closed", label: "Closed" },
];

type SortKey = "draft_name" | "customer" | "created_by" | "amount" | "status" | "due" | "attempts" | "quoted" | "orders";
type SortDir = "asc" | "desc";

function getSortValue(lead: FollowUpLead, key: SortKey): string | number {
  switch (key) {
    case "draft_name": return lead.draft_name.toLowerCase();
    case "customer": return (lead.customer_name || "zzz").toLowerCase();
    case "created_by": return (lead.created_by_staff || "zzz").toLowerCase();
    case "amount": return Number(lead.quote_amount);
    case "status": return lead.lead_status;
    case "due": return lead.next_followup_at || "9999";
    case "attempts": return lead.followup_count;
    case "quoted": return lead.shopify_created_at || lead.created_at;
    // Sort unknowns (null) last regardless of direction by parking them above any real count.
    case "orders": return lead.customer_orders_count ?? Number.MAX_SAFE_INTEGER;
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg viewBox="0 0 12 12" className={`w-3 h-3 inline-block ml-1 ${active ? "text-blue-500" : "text-sand-300"}`}>
      <path d="M6 1L9 5H3L6 1Z" fill={active && dir === "asc" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1" />
      <path d="M6 11L3 7H9L6 11Z" fill={active && dir === "desc" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export default function LeadTable({ leads, filter, onFilterChange, onLogFollowUp, onViewDetail, onBulkClose, filterCounts }: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkClosing, setBulkClosing] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "amount" || key === "attempts" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        l.draft_name.toLowerCase().includes(q) ||
        (l.customer_name || "").toLowerCase().includes(q) ||
        (l.customer_email || "").toLowerCase().includes(q) ||
        (l.customer_phone || "").includes(q) ||
        (l.created_by_staff || "").toLowerCase().includes(q)
    );
  }, [leads, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: "draft_name", label: "Draft #", align: "text-left" },
    { key: "customer", label: "Customer", align: "text-left" },
    { key: "created_by", label: "Created By", align: "text-left" },
    { key: "amount", label: "Amount", align: "text-right" },
    { key: "status", label: "Status", align: "text-left" },
    { key: "due", label: "Due", align: "text-left" },
    { key: "attempts", label: "Attempts", align: "text-center" },
    { key: "orders", label: "Lifetime Orders", align: "text-center" },
    { key: "quoted", label: "Quoted", align: "text-left" },
  ];

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      {/* Tab bar + search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-sand-200/60 px-4 pt-3 gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const count = filterCounts[tab.value] ?? 0;
            const active = filter === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => onFilterChange(tab.value)}
                className={`px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                  active
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-sand-500 hover:text-sand-700 hover:bg-sand-50"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    active ? "bg-blue-100 text-blue-600" : "bg-sand-100 text-sand-500"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pb-2 sm:pb-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, draft #..."
            className="w-full sm:w-64 px-3 py-1.5 text-sm border border-sand-200 rounded-lg bg-sand-50 text-sand-700 placeholder-sand-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white"
          />
        </div>
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-b border-blue-200">
          <span className="text-sm font-medium text-blue-700">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBulkModal(true)}
              className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Mark as Lost
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-xs text-sand-500 hover:text-sand-700 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Bulk close modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowBulkModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-sand-900">Close {selected.size} leads as Lost</h3>
            <div>
              <label className="block text-sm font-medium text-sand-700 mb-2">Reason <span className="text-red-500">*</span></label>
              <div className="space-y-1.5">
                {LOSS_REASONS.map((reason) => (
                  <label key={reason} className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" name="bulkReason" value={reason} checked={bulkReason === reason} onChange={() => setBulkReason(reason)} className="text-blue-600" />
                    <span className="text-sm text-sand-700">{reason}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowBulkModal(false); setBulkReason(""); }} className="px-4 py-2 text-sm text-sand-600">Cancel</button>
              <button
                onClick={async () => {
                  if (!bulkReason) return;
                  setBulkClosing(true);
                  await onBulkClose(Array.from(selected), bulkReason);
                  setSelected(new Set());
                  setShowBulkModal(false);
                  setBulkReason("");
                  setBulkClosing(false);
                }}
                disabled={!bulkReason || bulkClosing}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {bulkClosing ? "Closing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="py-12 text-center text-sand-400 text-sm">
          {search ? "No leads match your search." : "No leads to show for this filter."}
        </div>
      ) : (
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-white">
              <tr className="border-b border-sand-200/60">
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === sorted.filter((l) => !l.closed_at).length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(sorted.filter((l) => !l.closed_at).map((l) => l.id)));
                      } else {
                        setSelected(new Set());
                      }
                    }}
                    className="text-blue-600"
                  />
                </th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`${col.align} align-bottom px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium cursor-pointer hover:text-sand-600 select-none`}
                  >
                    {/* Keep label + sort caret on the same baseline. Without
                        this, multi-word headers (DRAFT #, LIFETIME ORDERS)
                        wrap and drop the caret below, making the row taller
                        than its single-line neighbors. */}
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {col.label}
                      <SortIcon active={sortKey === col.key} dir={sortDir} />
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((lead) => {
                const due = formatDueDate(lead.next_followup_at);
                const statusLabel = FOLLOWUP_CATEGORIES[lead.lead_status as LeadStatus]?.label ?? lead.lead_status;
                const statusColor = STATUS_COLORS[lead.lead_status] ?? "bg-sand-100 text-sand-600";
                const isStale = lead.shopify_status === "DELETED";
                const nearMax = lead.followup_count >= MAX_ATTEMPTS && !lead.closed_at;
                const isSelected = selected.has(lead.id);

                return (
                  <tr
                    key={lead.id}
                    className={`border-b border-sand-100 hover:bg-sand-50/50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50/50" : ""}`}
                    onClick={() => onViewDetail(lead)}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {!lead.closed_at && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            const next = new Set(selected);
                            if (isSelected) next.delete(lead.id); else next.add(lead.id);
                            setSelected(next);
                          }}
                          className="text-blue-600"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-sand-900">
                      {lead.draft_name}
                      {isStale && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500 font-medium">Stale</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-700">
                      <div>{lead.customer_name || "Unknown"}</div>
                      {lead.customer_email && (
                        <div className="text-[11px] text-sand-400 truncate max-w-[200px]">{lead.customer_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-700 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {lead.created_by_staff || <span className="text-sand-400">—</span>}
                        {lead.contributors && lead.contributors.length > 1 && (
                          <span
                            title={`Worked by: ${lead.contributors.join(", ")}${lead.last_invoice_sender ? `\nLast invoice: ${lead.last_invoice_sender}` : ""}`}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sand-100 text-sand-500 text-[10px] font-medium cursor-help"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                            </svg>
                            +{lead.contributors.length - 1}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-sand-900">
                      {formatAmount(Number(lead.quote_amount))}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-sm ${due.className}`}>{due.text}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={nearMax ? "text-red-600 font-medium" : "text-sand-600"}>
                        {lead.followup_count}
                      </span>
                      {nearMax && (
                        <span className="ml-1 text-[10px] text-red-500">!</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {lead.customer_orders_count == null ? (
                        <span className="text-sand-300">—</span>
                      ) : lead.customer_orders_count === 0 ? (
                        <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          New
                        </span>
                      ) : (
                        <span className="text-sand-700">{lead.customer_orders_count}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-500">{formatDate(lead.shopify_created_at || lead.created_at)}</td>
                    <td className="px-4 py-3">
                      {!lead.closed_at && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onLogFollowUp(lead); }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                        >
                          Log Follow-up
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
