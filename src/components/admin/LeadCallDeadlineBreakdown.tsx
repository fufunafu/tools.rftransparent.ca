"use client";

import type { LeadSource } from "@/lib/customer-service/leads";
import type { BusinessDayCallMetrics } from "@/lib/lead-business-day";

const categories = [
  { key: "onTime", label: "Called on time", color: "bg-emerald-500" },
  { key: "late", label: "Called late", color: "bg-amber-500" },
  { key: "overdue", label: "Overdue, not called", color: "bg-rose-500" },
  { key: "pending", label: "Still within deadline", color: "bg-blue-400" },
  { key: "unknown", label: "Timing unavailable", color: "bg-slate-300" },
] as const;
const sourceNames = { website: "Website", meta: "Meta", outreach: "Outreach" };

export default function LeadCallDeadlineBreakdown({ metrics, sources, loading, error, period, trackingStartedAt }: {
  metrics: Record<LeadSource, BusinessDayCallMetrics>;
  sources: Record<LeadSource, boolean>;
  loading: boolean;
  error?: string | null;
  period: string;
  trackingStartedAt?: string | null;
}) {
  return <article className="rounded-xl border border-sand-200 bg-white shadow-sm shadow-slate-200/30">
    <header className="border-b border-sand-100 px-4 py-3">
      <h2 className="text-sm font-semibold text-sand-900">First-call follow-up</h2>
      <p className="mt-1 text-xs text-sand-500">{period} · Callable leads by source</p>
      <p className="mt-1 text-xs leading-5 text-sand-500">Due by 5 p.m. Toronto time. Requests received at or after 5 p.m. or on weekends are due the next weekday. Friday evening is due Monday.</p>
    </header>
    <div className="space-y-5 p-4">
      {loading ? <p role="status" className="text-sm text-sand-500">Loading call records...</p> : error ? <p role="alert" className="text-sm text-red-700">Call records could not be loaded: {error}</p> : (Object.keys(sourceNames) as LeadSource[]).filter(source => sources[source]).map(source => {
        const values = metrics[source];
        return <section key={source} aria-label={`${sourceNames[source]} call follow-up`}>
          <div className="mb-2 flex justify-between text-xs"><h3 className="font-semibold text-sand-800">{sourceNames[source]}</h3><span className="text-sand-500">{values.total ? `${values.total} callable leads` : "No data"}</span></div>
          {values.total > 0 && <>
            <div role="img" aria-label={categories.map(category => `${category.label}: ${values[category.key]}`).join(", ")} className="flex h-6 overflow-hidden rounded bg-sand-100">
              {categories.filter(category => values[category.key] > 0).map(category => <span key={category.key} title={`${category.label}: ${values[category.key]}`} className={category.color} style={{ width: `${values[category.key] / values.total * 100}%` }} />)}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              {categories.map(category => <div key={category.key} className="flex items-start gap-1.5"><span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-sm ${category.color}`} /><dt className="text-sand-500">{category.label}</dt><dd className="ml-auto font-semibold tabular-nums text-sand-800">{values[category.key]}</dd></div>)}
            </dl>
          </>}
        </section>;
      })}
      {trackingStartedAt && <p className="text-[11px] text-sand-500">Call history available from {new Date(trackingStartedAt).toLocaleDateString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric" })}. Earlier leads are not scored.</p>}
      <p className="text-[11px] leading-5 text-sand-500">A recorded call attempt counts, even if unanswered. Undated calls are shown as timing unavailable. Weekends are skipped; public holidays are not adjusted.</p>
    </div>
  </article>;
}
