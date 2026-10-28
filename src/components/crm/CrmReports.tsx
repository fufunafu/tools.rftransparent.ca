"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { REPORT_METRICS, REPORT_PERIODS, reportRange, type CrmTeamReport, type ReportPeriod } from "@/lib/crm/report";
import { BUTTON, ErrorMessage, fetchJson, stageLabel } from "./shared";

const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || BUSINESS_TIMEZONE;
const serverZone = () => BUSINESS_TIMEZONE;

/** Team activity by person for a period, plus contacts by lifecycle stage. */
export default function CrmReports({ email }: { email: string }) {
  const timeZone = useSyncExternalStore(subscribe, browserZone, serverZone);
  const [period, setPeriod] = useState<ReportPeriod>("this_week");
  // Recompute the range only when the period or zone changes, so SWR keeps one key.
  const current = useMemo(() => reportRange(period, new Date(), timeZone), [period, timeZone]);
  const { data, error, isLoading, isValidating, mutate } = useSWR<CrmTeamReport>(`/api/crm/reports?start=${encodeURIComponent(current.start)}&end=${encodeURIComponent(current.end)}`, fetchJson, { keepPreviousData: true });
  const totals = Object.fromEntries(REPORT_METRICS.map(([key]) => [key, data?.people.reduce((sum, person) => sum + Number(person[key]), 0) ?? 0]));
  const day = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone });
  const endLabel = data ? day.format(new Date(Date.parse(data.end) - 1)) : "";
  const maxStage = Math.max(1, ...(data?.stages ?? []).map(stage => stage.count));
  const stageTotal = (data?.stages ?? []).reduce((sum, stage) => sum + stage.count, 0);
  return <section className="space-y-4" aria-label="CRM reports" aria-busy={isValidating}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-2xl font-semibold text-slate-900">Reports</h2><p className="mt-1 text-xs text-slate-500">{data ? `${day.format(new Date(data.start))} to ${endLabel}` : "Loading period"} · Saved CRM activity by owner</p></div>
      <div className="flex flex-wrap items-center gap-2"><div role="group" aria-label="Report period" className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">{(Object.keys(REPORT_PERIODS) as ReportPeriod[]).map(key => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)} className={`min-h-10 rounded-md px-3 text-sm font-semibold ${period === key ? "bg-orange-50 text-orange-800" : "text-slate-500 hover:bg-slate-50"}`}>{REPORT_PERIODS[key]}</button>)}</div><button className={BUTTON} disabled={isValidating} onClick={() => void mutate()}>Refresh</button></div>
    </div>
    <ErrorMessage error={error} />
    {isLoading && !data && <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading report...</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{REPORT_METRICS.filter(([key]) => key !== "tasks_overdue").map(([key, label]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{totals[key].toLocaleString()}</p></div>)}</div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Activity by team member</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><tr><th scope="col" className="px-4 py-3">Team member</th>{REPORT_METRICS.map(([key, label]) => <th key={key} scope="col" className="px-4 py-3 text-right">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{data.people.map(person => <tr key={person.owner || "unassigned"} className={person.owner === email ? "bg-orange-50/40" : ""}><th scope="row" className="px-4 py-3 font-medium capitalize text-slate-800">{person.name}{person.owner === email && <span className="ml-2 text-xs font-normal normal-case text-slate-500">(you)</span>}</th>{REPORT_METRICS.map(([key]) => <td key={key} className={`px-4 py-3 text-right tabular-nums ${key === "tasks_overdue" && person[key] > 0 ? "font-semibold text-red-700" : "text-slate-700"}`}>{Number(person[key]).toLocaleString()}</td>)}</tr>)}
            {!data.people.length && <tr><td colSpan={REPORT_METRICS.length + 1} className="px-4 py-8 text-center text-sm text-slate-500">No saved activity in this period.</td></tr>}</tbody>
          {data.people.length > 1 && <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900"><tr><th scope="row" className="px-4 py-3">Team total</th>{REPORT_METRICS.map(([key]) => <td key={key} className="px-4 py-3 text-right tabular-nums">{totals[key].toLocaleString()}</td>)}</tr></tfoot>}
        </table></div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">Counts saved calls, emails, meetings and notes dated in the period, contacts added in the period, and tasks completed with a due date in the period. Overdue is open tasks past due right now. Owner uses Tools reassignments first.</p>
      </div>
      <section aria-label="Contacts by lifecycle stage" className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-900">Contacts by lifecycle stage</h3><p className="mt-1 text-xs text-slate-500">All active contacts · {stageTotal.toLocaleString()} total</p>
        <ul className="mt-4 space-y-2">{data.stages.map(stage => { const label = stage.label && !/^\d+$/.test(stage.label) ? stageLabel(stage.label) : stageLabel(stage.value); return <li key={stage.value || "none"} className="grid grid-cols-[9rem_minmax(0,1fr)_4rem] items-center gap-3 text-sm" title={`${label}: ${stage.count.toLocaleString()} contacts`}>
          <span className="truncate text-slate-700">{label}</span>
          <span className="h-3 rounded-r bg-slate-100" aria-hidden="true"><span className="block h-3 rounded-r bg-cyan-700" style={{ width: `${Math.max(1, (stage.count / maxStage) * 100)}%` }} /></span>
          <span className="text-right tabular-nums text-slate-700">{stage.count.toLocaleString()}</span>
        </li>; })}</ul>
      </section>
    </>}
  </section>;
}
