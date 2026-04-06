"use client";

import { FOLLOWUP_CATEGORIES, MAX_ATTEMPTS, type LeadStatus } from "@/lib/followup";
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
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface Props {
  leads: FollowUpLead[];
  filter: string;
  onFilterChange: (f: string) => void;
  onLogFollowUp: (lead: FollowUpLead) => void;
  onViewDetail: (lead: FollowUpLead) => void;
  filterCounts: Record<string, number>;
}

const FILTER_TABS = [
  { value: "due_today", label: "Due Today" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All Active" },
  { value: "closed", label: "Closed" },
];

export default function LeadTable({ leads, filter, onFilterChange, onLogFollowUp, onViewDetail, filterCounts }: Props) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-sand-200/60 px-4 pt-3 gap-1 overflow-x-auto">
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

      {/* Table */}
      {leads.length === 0 ? (
        <div className="py-12 text-center text-sand-400 text-sm">
          No leads to show for this filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200/60">
                <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Draft #</th>
                <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Customer</th>
                <th className="text-right px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Status</th>
                <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Due</th>
                <th className="text-center px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Attempts</th>
                <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quoted</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const due = formatDueDate(lead.next_followup_at);
                const statusLabel = FOLLOWUP_CATEGORIES[lead.lead_status as LeadStatus]?.label ?? lead.lead_status;
                const statusColor = STATUS_COLORS[lead.lead_status] ?? "bg-sand-100 text-sand-600";
                const isStale = lead.shopify_status === "DELETED";
                const nearMax = lead.followup_count >= MAX_ATTEMPTS && !lead.closed_at;

                return (
                  <tr
                    key={lead.id}
                    className="border-b border-sand-100 hover:bg-sand-50/50 cursor-pointer transition-colors"
                    onClick={() => onViewDetail(lead)}
                  >
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
