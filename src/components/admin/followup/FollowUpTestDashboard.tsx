"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LeadTable from "@/components/admin/followup/LeadTable";
import FollowUpModal from "@/components/admin/followup/FollowUpModal";
import {
  loadTestLeads,
  resetTestData,
  logTestFollowUp,
  bulkCloseTestLeads,
} from "@/lib/followup-test-data";
import {
  DEFAULT_FOLLOWUP_DAYS,
  FOLLOWUP_CATEGORIES,
  type FollowUpLead,
  type LeadStatus,
} from "@/lib/followup";

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function tomorrowStart(): Date {
  const d = todayStart();
  d.setDate(d.getDate() + 1);
  return d;
}

export default function FollowUpTestDashboard() {
  const [leads, setLeads] = useState<FollowUpLead[]>([]);
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState("all");
  const [modalLead, setModalLead] = useState<FollowUpLead | null>(null);

  // Seed/load on mount — localStorage isn't accessible during SSR.
  useEffect(() => {
    setLeads(loadTestLeads());
    setMounted(true);
  }, []);

  const handleReset = () => {
    if (!confirm("Reset the 10 test leads and wipe all practice follow-ups?")) return;
    const { leads: fresh } = resetTestData();
    setLeads(fresh);
  };

  const handleLog = async (data: {
    lead_id: string;
    outcome: LeadStatus;
    notes?: string;
    close_reason?: string;
    custom_date?: string;
  }) => {
    const { leads: next } = logTestFollowUp({ ...data, loggedBy: "test user" });
    setLeads(next);
    setModalLead(null);
  };

  const handleBulkClose = async (ids: string[], reason: string) => {
    const { leads: next } = bulkCloseTestLeads(ids, "lost", reason || undefined);
    setLeads(next);
  };

  // Compute counts and the filtered set the same way the live API does.
  const today = todayStart().toISOString();
  const tomorrow = tomorrowStart().toISOString();
  const active = leads.filter((l) => !l.closed_at);
  const dueToday = active.filter((l) => l.next_followup_at && l.next_followup_at >= today && l.next_followup_at < tomorrow);
  const overdue = active.filter((l) => l.next_followup_at && l.next_followup_at < today);
  const upcoming = active.filter((l) => l.next_followup_at && l.next_followup_at >= tomorrow);
  const closed = leads.filter((l) => l.closed_at);

  const filterCounts: Record<string, number> = {
    due_today: dueToday.length,
    overdue: overdue.length,
    upcoming: upcoming.length,
    all: active.length,
    closed: closed.length,
  };

  const filteredLeads =
    filter === "due_today" ? dueToday
    : filter === "overdue" ? overdue
    : filter === "upcoming" ? upcoming
    : filter === "closed" ? closed
    : active;

  // Group active leads by status for the headline pills.
  const byStatus = active.reduce<Record<string, number>>((acc, l) => {
    acc[l.lead_status] = (acc[l.lead_status] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      {/* Banner — this is the whole point: make it impossible to forget you're in test mode. */}
      <div className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-4 mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-xs font-bold uppercase tracking-wider">
            Test Mode
          </span>
          <p className="text-sm text-amber-900">
            Practice doing follow-ups on 10 fake draft orders. Nothing here touches real Shopify data or the live CRM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
          >
            Reset test data
          </button>
          <Link
            href="/customer-service/follow-up"
            prefetch={false}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 transition-colors"
          >
            Back to live dashboard
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Follow-up CRM (Test)</h1>
          <p className="text-sm text-sand-500 mt-0.5">
            {active.length} active · {dueToday.length} due today · {overdue.length} overdue · {closed.length} closed
          </p>
        </div>
      </div>

      {/* Status pills — purely informational here; the real dashboard makes them clickable. */}
      {mounted && Object.keys(byStatus).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.entries(byStatus)
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => {
              const label = FOLLOWUP_CATEGORIES[status as LeadStatus]?.label ?? status;
              return (
                <span
                  key={status}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-sand-100 text-sand-700"
                >
                  {label}
                  <span className="font-semibold">{count}</span>
                </span>
              );
            })}
        </div>
      )}

      {/* Lead table — same component the live page uses. */}
      <LeadTable
        leads={filteredLeads}
        filter={filter}
        onFilterChange={setFilter}
        onLogFollowUp={(lead) => setModalLead(lead)}
        onViewDetail={(lead) => setModalLead(lead)}
        onBulkClose={handleBulkClose}
        filterCounts={filterCounts}
      />

      {/* Log Follow-up modal — submits into localStorage. */}
      {modalLead && (
        <FollowUpModal
          lead={modalLead}
          storeDays={DEFAULT_FOLLOWUP_DAYS}
          onClose={() => setModalLead(null)}
          onSubmit={handleLog}
        />
      )}
    </>
  );
}
