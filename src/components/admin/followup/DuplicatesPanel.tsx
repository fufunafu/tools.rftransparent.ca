"use client";

import { useState } from "react";
import { FollowUpLead, FOLLOWUP_CATEGORIES, LeadStatus } from "@/lib/followup";

export interface DupGroup {
  email: string;
  customer_name: string | null;
  count: number;
  total_amount: number;
  leads: FollowUpLead[];
}

interface Props {
  groups: DupGroup[];
  loading: boolean;
  onResolve: (group: DupGroup) => Promise<void>;
  onDismiss: (group: DupGroup) => Promise<void>;
  onViewDetail: (lead: FollowUpLead) => void;
}

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DuplicatesPanel({ groups, loading, onResolve, onDismiss, onViewDetail }: Props) {
  // Track which group (by email) is mid-action, and what action, to disable buttons.
  const [busy, setBusy] = useState<Record<string, "resolve" | "dismiss" | undefined>>({});

  const run = async (group: DupGroup, kind: "resolve" | "dismiss") => {
    setBusy((b) => ({ ...b, [group.email]: kind }));
    try {
      if (kind === "resolve") await onResolve(group);
      else await onDismiss(group);
    } finally {
      setBusy((b) => ({ ...b, [group.email]: undefined }));
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sand-400 text-sm">Scanning for duplicates…</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sand-700 font-medium">No possible duplicates 🎉</p>
        <p className="text-sand-400 text-sm mt-1">
          Every customer with an open quote has just one. New collisions will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-sand-500">
        {groups.length} customer{groups.length === 1 ? "" : "s"} with more than one open quote. For each, keep the
        right one or confirm they&apos;re genuinely separate orders.
      </p>

      {groups.map((group) => {
        const keeper = group.leads[0]; // server sorts newest first
        const state = busy[group.email];
        const disabled = !!state;
        return (
          <div key={group.email} className="border border-sand-200 rounded-xl overflow-hidden">
            {/* Group header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-sand-50 border-b border-sand-200/70">
              <div className="min-w-0">
                <p className="font-medium text-sand-900 truncate">{group.customer_name || "Unknown customer"}</p>
                <p className="text-xs text-sand-500 truncate">{group.email}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                  {group.count} open quotes
                </span>
                <span className="text-sand-500">{formatAmount(group.total_amount)} total</span>
              </div>
            </div>

            {/* Quotes in this group */}
            <div className="divide-y divide-sand-100">
              {group.leads.map((lead, i) => {
                const statusLabel = FOLLOWUP_CATEGORIES[lead.lead_status as LeadStatus]?.label ?? lead.lead_status;
                const isKeeper = i === 0;
                return (
                  <div
                    key={lead.id}
                    onClick={() => onViewDetail(lead)}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-sand-50/60 cursor-pointer"
                  >
                    <span className="font-medium text-sand-900 w-20">{lead.draft_name}</span>
                    <span className="text-sand-700 w-24 text-right">{formatAmount(Number(lead.quote_amount))}</span>
                    <span className="text-xs text-sand-500 w-28">Quoted {formatDate(lead.shopify_created_at || lead.created_at)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-sand-100 text-sand-600">{statusLabel}</span>
                    <span className="text-xs text-sand-400">{lead.followup_count} follow-up{lead.followup_count === 1 ? "" : "s"}</span>
                    {isKeeper && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                        newest — kept
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 bg-sand-50/50 border-t border-sand-200/70">
              <button
                onClick={() => run(group, "dismiss")}
                disabled={disabled}
                className="px-3 py-1.5 text-xs font-medium text-sand-600 border border-sand-300 rounded-lg hover:bg-sand-100 disabled:opacity-50"
              >
                {state === "dismiss" ? "Saving…" : "Not duplicates"}
              </button>
              <button
                onClick={() => run(group, "resolve")}
                disabled={disabled}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                title={`Closes the other ${group.count - 1} quote${group.count - 1 === 1 ? "" : "s"} as duplicate, keeping ${keeper.draft_name}`}
              >
                {state === "resolve" ? "Merging…" : `Keep ${keeper.draft_name}, close ${group.count - 1} as duplicate`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
