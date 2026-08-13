"use client";

import { formatCADShort } from "@/lib/format";
import type { FollowupOverview } from "@/lib/ops-dashboard";
import { CardShell, Stat, num, pct } from "@/components/admin/dashboard/widgets";

// Follow-up CRM workload. Numbers come from the same per-store summary RPC
// the Follow-up page uses, so the two always agree.

export function FollowupCard({ f, note }: { f: FollowupOverview; note?: string }) {
  return (
    <CardShell
      label="Leads & follow-ups"
      note={note}
      footer={
        <>
          <span className="text-slate-500">
            Pipeline{" "}
            <span className="font-semibold text-slate-900 tabular-nums">
              {formatCADShort(f.pipelineValue)}
            </span>
          </span>
          <span className="text-slate-500">
            Win rate{" "}
            <span className="font-semibold text-slate-900 tabular-nums">{pct(f.conversionRate)}</span>
          </span>
        </>
      }
    >
      <Stat
        label="Due today"
        value={num(f.dueToday)}
        href="/customer-service/follow-up"
        tone={f.dueToday > 0 ? "text-amber-600" : "text-slate-900"}
        dataLabel="Follow-ups due today"
        calc="Active follow-up leads whose next follow-up date is today, summed across this dashboard's stores. Same predicate as the Follow-up page."
        src="Supabase · cs_followup_summary"
      />
      <Stat
        label="Overdue"
        value={num(f.overdue)}
        href="/customer-service/follow-up"
        tone={f.overdue > 0 ? "text-red-600" : "text-slate-900"}
        dataLabel="Follow-ups overdue"
        calc="Active follow-up leads whose next follow-up date is in the past, summed across this dashboard's stores."
        src="Supabase · cs_followup_summary"
      />
      <Stat
        label="Active leads"
        value={num(f.active)}
        href="/customer-service/follow-up"
        dataLabel="Active leads"
        calc="Follow-up leads not yet marked won or lost, summed across this dashboard's stores."
        src="Supabase · cs_followup_summary"
      />
    </CardShell>
  );
}
