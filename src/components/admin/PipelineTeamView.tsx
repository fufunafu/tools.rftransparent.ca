"use client";

import { useState } from "react";
import type { PipelineData, SortKey } from "./PipelineDashboard.types";
import {
  EmptySection,
  formatMoney,
  formatPercent,
  MetricCard,
  SectionHeader,
} from "./PipelineDashboardPrimitives";
import { getPipelineManagementSummary } from "@/lib/pipeline-dashboard-view";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "repName", label: "Rep" },
  { key: "totalDrafts", label: "Drafts" },
  { key: "completedDrafts", label: "Converted" },
  { key: "conversionRate", label: "Conversion" },
  { key: "pipelineValue", label: "Pipeline" },
  { key: "wonRevenue", label: "Won" },
  { key: "avgSaleValue", label: "Average sale" },
  { key: "avgCycleTimeDays", label: "Cycle time" },
];

export default function PipelineTeamView({ data }: { data: PipelineData }) {
  const [sortBy, setSortBy] = useState<SortKey>("wonRevenue");
  const [sortAscending, setSortAscending] = useState(false);
  const leaderboard = data.leaderboard ?? [];
  const employeeBreakdown = data.channelMetrics?.employeeBreakdown ?? [];
  const summary = getPipelineManagementSummary(
    leaderboard,
    data.channelMetrics?.draftRevenue ?? 0,
  );

  const sortedLeaderboard = [...leaderboard].sort((left, right) => {
    const leftValue = left[sortBy] ?? -1;
    const rightValue = right[sortBy] ?? -1;
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return sortAscending
        ? leftValue.localeCompare(rightValue)
        : rightValue.localeCompare(leftValue);
    }
    return sortAscending
      ? (leftValue as number) - (rightValue as number)
      : (rightValue as number) - (leftValue as number);
  });

  const sort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAscending((value) => !value);
      return;
    }
    setSortBy(key);
    setSortAscending(false);
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="team-summary-heading">
        <SectionHeader
          id="team-summary-heading"
          title="Management summary"
          description="The leaders and open opportunities that stand out in the selected period."
        />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div data-content-id="strongest-rep">
            <MetricCard
              label="Strongest rep"
              value={summary.strongestRep?.repName ?? "No sales yet"}
              detail={summary.strongestRep ? `${formatMoney(summary.strongestRep.wonRevenue)} won revenue` : "No attributed won revenue"}
              tone="green"
            />
          </div>
          <div data-content-id="highest-conversion">
            <MetricCard
              label="Highest conversion"
              value={summary.bestConverter?.repName ?? "No conversions"}
              detail={summary.bestConverter ? `${formatPercent(summary.bestConverter.conversionRate)} of quotes converted` : "No attributed conversions"}
              tone="green"
            />
          </div>
          <div data-content-id="largest-open-pipeline">
            <MetricCard
              label="Largest open pipeline"
              value={summary.largestPipeline?.repName ?? "No open pipeline"}
              detail={summary.largestPipeline ? `${formatMoney(summary.largestPipeline.pipelineValue)} pending` : "No attributed pending value"}
              tone="blue"
            />
          </div>
          <div data-content-id="quote-attributed-revenue">
            <MetricCard
              label="Quote-attributed revenue"
              value={formatMoney(summary.quoteAttributedRevenue)}
              detail={`${data.channelMetrics?.draftOrders ?? 0} paid quote orders`}
              tone="purple"
            />
          </div>
        </div>
      </section>

      <section
        data-content-id="rep-leaderboard"
        aria-labelledby="rep-leaderboard-heading"
        className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
      >
        <SectionHeader
          id="rep-leaderboard-heading"
          title="Rep leaderboard"
          description="Select a column to sort the existing quote, conversion, pipeline, and revenue calculations."
        />
        {sortedLeaderboard.length > 0 ? (
          <div className="mt-5 max-w-full overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {COLUMNS.map(({ key, label }) => {
                    const active = sortBy === key;
                    const alignment = key === "repName" ? "text-left" : "text-right";
                    return (
                      <th key={key} scope="col" aria-sort={active ? (sortAscending ? "ascending" : "descending") : "none"} className={`pb-2 ${alignment}`}>
                        <button
                          type="button"
                          onClick={() => sort(key)}
                          className={`inline-flex items-center gap-1 rounded text-[11px] font-medium uppercase tracking-wider text-slate-500 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${key === "repName" ? "" : "ml-auto"}`}
                        >
                          {label}
                          <span aria-hidden="true" className="text-[9px] text-slate-400">
                            {active ? (sortAscending ? "▲" : "▼") : "◆"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedLeaderboard.map((rep) => (
                  <tr key={rep.repTag} className="transition-colors hover:bg-slate-50">
                    <td className="py-3 font-medium text-slate-900">{rep.repName}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600">{rep.totalDrafts}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600">{rep.completedDrafts}</td>
                    <td className="py-3 text-right tabular-nums text-green-700">{formatPercent(rep.conversionRate)}</td>
                    <td className="py-3 text-right tabular-nums text-blue-700">{formatMoney(rep.pipelineValue)}</td>
                    <td className="py-3 text-right font-medium tabular-nums text-green-700">{formatMoney(rep.wonRevenue)}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600">{formatMoney(rep.avgSaleValue)}</td>
                    <td className="py-3 text-right tabular-nums text-slate-500">{rep.avgCycleTimeDays !== null ? `${rep.avgCycleTimeDays} days` : "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5"><EmptySection>No employee-attributed quote activity is available for this period.</EmptySection></div>
        )}
      </section>

      <section
        data-content-id="quote-revenue-by-employee"
        aria-labelledby="quote-revenue-employee-heading"
        className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
      >
        <SectionHeader
          id="quote-revenue-employee-heading"
          title="Quote revenue by employee"
          description="Paid revenue from orders linked to quotes, grouped by the attributed employee."
        />
        {employeeBreakdown.length > 0 ? (
          <div className="mt-5 space-y-4">
            {employeeBreakdown.map((employee) => {
              const share = summary.quoteAttributedRevenue > 0
                ? (employee.revenue / summary.quoteAttributedRevenue) * 100
                : 0;
              return (
                <div key={employee.repTag} className="grid grid-cols-[minmax(110px,1fr)_minmax(100px,3fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{employee.repName}</p>
                    <p className="text-xs text-slate-400">{employee.orders} {employee.orders === 1 ? "order" : "orders"}</p>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-purple-50" aria-hidden="true">
                    <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(100, share)}%` }} />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-purple-700">{formatMoney(employee.revenue)}</p>
                    <p className="text-xs tabular-nums text-slate-400">{formatMoney(employee.aov)} avg</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-5"><EmptySection>No employee attribution is available for paid quote orders.</EmptySection></div>
        )}
      </section>
    </div>
  );
}
