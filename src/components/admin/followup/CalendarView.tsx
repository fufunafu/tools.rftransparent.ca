"use client";

import { useState, useMemo } from "react";
import { FOLLOWUP_CATEGORIES, type LeadStatus, type FollowUpLead } from "@/lib/followup";
import { formatCADWhole } from "@/lib/format";

const STATUS_COLORS: Record<string, string> = {
  new: "border-l-blue-400",
  hot_lead: "border-l-red-400",
  considering: "border-l-amber-400",
  price_shopping: "border-l-orange-400",
  future_project: "border-l-purple-400",
  no_answer: "border-l-gray-400",
};

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

interface Props {
  leads: FollowUpLead[];
  onViewDetail: (lead: FollowUpLead) => void;
}

export default function CalendarView({ leads, onViewDetail }: Props) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  const weekDates = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const todayKey = dateKey(new Date());

  // Group leads by day
  const { byDay, overdue } = useMemo(() => {
    const map: Record<string, FollowUpLead[]> = {};
    const overdueList: FollowUpLead[] = [];
    const weekStartKey = dateKey(weekStart);

    for (const lead of leads) {
      if (!lead.next_followup_at || lead.closed_at) continue;
      const dueKey = lead.next_followup_at.split("T")[0];

      if (dueKey < weekStartKey) {
        overdueList.push(lead);
      } else {
        if (!map[dueKey]) map[dueKey] = [];
        map[dueKey].push(lead);
      }
    }

    // Sort overdue by amount desc
    overdueList.sort((a, b) => Number(b.quote_amount) - Number(a.quote_amount));

    return { byDay: map, overdue: overdueList };
  }, [leads, weekStart]);

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const goToday = () => setWeekStart(getMonday(new Date()));

  const weekLabel = `${weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${weekDates[4].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="space-y-3">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-sand-100 text-sand-500 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="text-sm font-medium text-sand-700 min-w-[180px] text-center">{weekLabel}</span>
          <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-sand-100 text-sand-500 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
        <button onClick={goToday} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Today</button>
      </div>

      {/* Overdue section */}
      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h4 className="text-xs font-medium text-red-700 uppercase tracking-wider mb-2">Overdue ({overdue.length})</h4>
          <div className="flex flex-wrap gap-2">
            {overdue.slice(0, 10).map((lead) => (
              <button
                key={lead.id}
                onClick={() => onViewDetail(lead)}
                className="bg-white border border-red-200 rounded-lg px-3 py-1.5 text-xs text-left hover:bg-red-50 transition-colors"
              >
                <span className="font-medium text-sand-900">{lead.customer_name || lead.draft_name}</span>
                <span className="text-sand-400 ml-1.5">{formatCADWhole(Number(lead.quote_amount))}</span>
              </button>
            ))}
            {overdue.length > 10 && (
              <span className="text-xs text-red-500 self-center">+{overdue.length - 10} more</span>
            )}
          </div>
        </div>
      )}

      {/* Week grid */}
      <div className="grid grid-cols-5 gap-2">
        {weekDates.map((date, i) => {
          const key = dateKey(date);
          const isToday = key === todayKey;
          const dayLeads = byDay[key] ?? [];
          dayLeads.sort((a, b) => Number(b.quote_amount) - Number(a.quote_amount));

          return (
            <div
              key={key}
              className={`bg-white rounded-xl border min-h-[200px] flex flex-col ${
                isToday ? "border-blue-300 ring-1 ring-blue-200" : "border-sand-200/60"
              }`}
            >
              {/* Day header */}
              <div className={`px-3 py-2 border-b text-xs font-medium ${
                isToday ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-sand-50 text-sand-500 border-sand-200/60"
              }`}>
                <div>{DAY_LABELS[i]}</div>
                <div className="text-[10px] font-normal">{date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>

              {/* Lead cards */}
              <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[300px]">
                {dayLeads.length === 0 ? (
                  <p className="text-[11px] text-sand-300 text-center py-4">No follow-ups</p>
                ) : (
                  dayLeads.map((lead) => {
                    const borderColor = STATUS_COLORS[lead.lead_status] ?? "border-l-sand-300";
                    return (
                      <button
                        key={lead.id}
                        onClick={() => onViewDetail(lead)}
                        className={`w-full text-left bg-sand-50 hover:bg-sand-100 rounded-lg px-2.5 py-2 border-l-[3px] ${borderColor} transition-colors`}
                      >
                        <div className="text-xs font-medium text-sand-900 truncate">
                          {lead.customer_name || lead.draft_name}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-sand-500">{formatCADWhole(Number(lead.quote_amount))}</span>
                          <span className="text-[10px] text-sand-400">
                            {FOLLOWUP_CATEGORIES[lead.lead_status as LeadStatus]?.label ?? lead.lead_status}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Day count */}
              {dayLeads.length > 0 && (
                <div className="px-3 py-1.5 border-t border-sand-100 text-[10px] text-sand-400 text-center">
                  {dayLeads.length} follow-up{dayLeads.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
