"use client";

import { useState } from "react";
import { formatCAD, formatCADShort } from "@/lib/format";
import { SALES_PERIODS } from "@/lib/sales-periods";
import type { SalesTeamOverview } from "@/lib/ops-dashboard";
import { delta } from "./widgets";
import { RANKINGS } from "./PerformersSection";
import { SalesRepName } from "./SalesRepName";
import { SalesRecordsDialog, type SalesRecordsSelection } from "./SalesRecordsDialog";

const ROWS = [
  { metric: "sold", label: "Net sales", kind: "orders", tone: "text-slate-900" },
  { metric: "quoted", label: "Quoted", kind: "quotes", tone: "text-blue-700" },
] as const;

export function SalesTeamTable({ data }: { data: SalesTeamOverview }) {
  const [metric, setMetric] = useState("sold");
  const [showDetails, setShowDetails] = useState(false);
  const [selection, setSelection] = useState<SalesRecordsSelection | null>(null);
  const people = [...data.periods["30d"]].sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Sales team</h3>
          <p className="mt-0.5 text-xs text-slate-500">Sales and quotes across the last 7 days to 1 year</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={showDetails} onClick={() => setShowDetails(!showDetails)}
            className={`h-8 rounded-md border px-3 text-xs font-medium ${showDetails ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {showDetails ? "Hide details" : "Show details"}
          </button>
          <select aria-label="Rank sales team by" value={metric} onChange={(event) => setMetric(event.target.value)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700">
            {RANKINGS.sales.map((option) => <option key={option.key} value={option.key}>Rank by {option.label}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-soft" role="region" aria-label="Sales by rep and period" tabIndex={0}>
        <table className="w-full min-w-[900px] text-left">
          <caption className="sr-only">Sales team across all five date ranges. Each rep has net sales and quoted rows. Rows are ranked using the last 30 days.</caption>
          <thead>
            <tr className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th scope="col" className="min-w-[180px] px-4 py-3">Sales rep</th>
              <th scope="col" className="w-20 px-2 py-3"><span className="sr-only">Metric</span></th>
              {SALES_PERIODS.map((period) => <th scope="col" key={period.id} className="px-4 py-3 text-right whitespace-nowrap">{period.label.replace("Last ", "")}</th>)}
            </tr>
          </thead>
          {people.map((person, index) => (
            <tbody key={person.id} className={`border-t border-slate-200/70 ${index % 2 ? "bg-slate-50/40" : "bg-white"}`}>
              {ROWS.map((row, rowIndex) => (
                <tr key={row.metric}>
                  {rowIndex === 0 && <th scope="rowgroup" rowSpan={2} className="px-4 py-3 align-middle font-normal">
                    <SalesRepName person={person} rank={index + 1} />
                    {person.meta === "$0 for now" && <span className="ml-[30px] mt-1 block text-[10px] text-slate-400">$0 for now</span>}
                  </th>}
                  <th scope="row" className={`px-2 text-[11px] font-medium whitespace-nowrap ${row.tone} ${rowIndex === 0 ? "pt-3 pb-1" : "pt-1 pb-3"}`}>{row.label}</th>
                  {SALES_PERIODS.map((period) => {
                    const entry = data.periods[period.id].find((rep) => rep.id === person.id);
                    const amount = entry?.metrics[row.metric] ?? 0;
                    const change = row.metric === "sold" && entry ? delta(entry.value, entry.previous) : null;
                    return <td key={period.id} className={`px-4 text-right tabular-nums ${rowIndex === 0 ? "pt-3 pb-1" : "pt-1 pb-3"}`}>
                      {entry ? <button type="button"
                        onClick={() => setSelection({ repId: person.id, repName: person.name, period: period.id, kind: row.kind })}
                        aria-label={`View ${person.name} ${row.kind} for ${period.label.toLowerCase()}`}
                        title={`${formatCAD(amount)} · click to view ${row.kind}`}
                        className={`rounded px-1 py-0.5 -mr-1 text-[15px] font-semibold hover:bg-blue-50 hover:text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${amount === 0 ? "text-slate-400" : row.tone}`}>
                        {formatCADShort(amount)}
                      </button> : <span className="text-xs text-slate-400">Unavailable</span>}
                      {showDetails && entry && <div className="mt-1 text-[10px] leading-relaxed">
                        {row.metric === "sold" ? <>
                          {change && <span className={`block ${change.tone}`}>{change.text} vs prior period</span>}
                          <span className="block text-slate-400">{entry.meta}</span>
                        </> : <span className="text-slate-400">{(entry.metrics.conversion ?? 0).toFixed(1)}% converted</span>}
                      </div>}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot className="border-t border-slate-200 bg-slate-50">
            {ROWS.map((row, index) => <tr key={row.metric}>
              {index === 0 && <th scope="rowgroup" rowSpan={2} className="px-4 py-3 text-[13px] font-semibold text-slate-900">All reps</th>}
              <th scope="row" className={`px-2 text-[11px] font-medium ${row.tone} ${index === 0 ? "pt-3 pb-1" : "pt-1 pb-3"}`}>{row.label}</th>
              {SALES_PERIODS.map((period) => <td key={period.id} className={`px-4 text-right text-[15px] font-semibold tabular-nums ${row.tone} ${index === 0 ? "pt-3 pb-1" : "pt-1 pb-3"}`}>
                {formatCADShort(data.periods[period.id].reduce((sum, rep) => sum + (rep.metrics[row.metric] ?? 0), 0))}
              </td>)}
            </tr>)}
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-[11px] text-slate-500">
        <p>Click an amount to see its orders or quotes. Ranking uses the last 30 days.</p>
        <details className="max-w-2xl">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">How totals are calculated</summary>
          <div className="mt-2 space-y-1 leading-relaxed">
            <p>Net sales are payments received less refunds, excluding tax and shipping. Changes compare with the preceding period of the same length.</p>
            <p>Rob and Craig: tagged RF orders. Daniel: RF orders in Quebec, Nova Scotia, New Brunswick and PEI, with territory taking priority over tags. Aaron: RF orders and quotes in British Columbia created July 16, 2026 onward, except those tagged to Rob. Marie: BC Transparent orders and quotes tagged Marijac.</p>
          </div>
        </details>
      </div>
      {selection && <SalesRecordsDialog key={`${selection.repId}:${selection.period}:${selection.kind}`} selection={selection} onClose={() => setSelection(null)} />}
      {data.warnings.length > 0 && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><p className="font-semibold">Some totals may be incomplete.</p><ul className="list-disc pl-4">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    </div>
  );
}
