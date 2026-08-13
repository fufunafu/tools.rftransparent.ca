"use client";

import dynamic from "next/dynamic";
import type { PipelineData } from "./PipelineDashboard.types";
import {
  EmptySection,
  formatMoney,
  formatMoneyFull,
  formatPercent,
  InfoTip,
  MetricCard,
  SectionHeader,
} from "./PipelineDashboardPrimitives";
import {
  getPipelineAttentionItems,
  getPipelinePositiveSummary,
} from "@/lib/pipeline-dashboard-view";

function ChartLoading({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center text-sm text-slate-400 motion-safe:animate-pulse"
    >
      Loading chart...
    </div>
  );
}

const MonthlyTrendChart = dynamic(
  () => import("./PipelineCharts").then((module) => module.MonthlyTrendChart),
  { ssr: false, loading: () => <ChartLoading height={300} /> },
);

const StatusBreakdownChart = dynamic(
  () => import("./PipelineCharts").then((module) => module.StatusBreakdownChart),
  { ssr: false, loading: () => <ChartLoading height={72} /> },
);

const HEALTH_TOOLTIPS = {
  conversion: "Completed draft orders divided by all draft orders in the selected period.",
  cycle: "Average days from quote creation to payment for completed drafts, excluding outliers over 180 days.",
  sale: "Won revenue divided by completed draft orders.",
  value: "Completed quote revenue divided by total quoted value.",
};

export default function PipelineOverviewView({ data }: { data: PipelineData }) {
  const metrics = data.metrics;
  const channel = data.channelMetrics;
  const buckets = data.prediction?.buckets ?? [];
  const attentionItems = getPipelineAttentionItems(metrics);
  const oldestActiveBucket = [...buckets].reverse().find((bucket) => bucket.drafts > 0);
  const directShare = Math.round((100 - channel.draftRevenueShare) * 10) / 10;

  return (
    <div className="space-y-8">
      <section data-content-id="pipeline-flow" aria-labelledby="pipeline-flow-heading">
        <SectionHeader
          title="Pipeline health"
          description="See how quoted value moves into won revenue and what remains active."
        />
        <h3 id="pipeline-flow-heading" className="sr-only">Quoted, won, and pending flow</h3>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
          <FlowStage
            label="Quoted"
            value={formatMoney(metrics.totalQuotedValue)}
            detail={`${metrics.totalDrafts} quotes created`}
            tone="slate"
          />
          <FlowArrow />
          <FlowStage
            label="Won"
            value={formatMoney(metrics.wonRevenue)}
            detail={`${metrics.completedDrafts} completed sales`}
            tone="green"
          />
          <FlowArrow />
          <FlowStage
            label="Pending"
            value={formatMoney(metrics.pipelineValue)}
            detail={`${metrics.invoiceSentDrafts} invoiced, ${metrics.openDrafts} open`}
            tone="blue"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div data-content-id="conversion-rate">
            <MetricCard
              label="Conversion rate"
              value={formatPercent(metrics.conversionRate)}
              detail={`${metrics.completedDrafts} of ${metrics.totalDrafts} quotes`}
              tone="green"
            />
          </div>
          <div data-content-id="average-cycle-time">
            <MetricCard
              label="Average cycle time"
              value={metrics.avgCycleTimeDays > 0 ? `${metrics.avgCycleTimeDays} days` : "N/A"}
              detail="From quote to paid order"
              tone="slate"
            />
          </div>
          <div data-content-id="average-sale">
            <MetricCard
              label="Average sale"
              value={formatMoney(metrics.avgSaleValue)}
              detail={`Across ${metrics.completedDrafts} completed sales`}
              tone="slate"
            />
          </div>
          <div data-content-id="value-win-rate">
            <MetricCard
              label="Value win rate"
              value={formatPercent(metrics.valueWinRate)}
              detail="Won value as a share of quoted value"
              tone="slate"
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          <InfoLabel text={HEALTH_TOOLTIPS.conversion}>Conversion</InfoLabel>
          <InfoLabel text={HEALTH_TOOLTIPS.cycle}>Cycle time</InfoLabel>
          <InfoLabel text={HEALTH_TOOLTIPS.sale}>Average sale</InfoLabel>
          <InfoLabel text={HEALTH_TOOLTIPS.value}>Value win rate</InfoLabel>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section
          data-content-id="monthly-pipeline-trend"
          aria-labelledby="monthly-pipeline-trend-heading"
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
        >
          <SectionHeader
            title="Monthly pipeline trend"
            description="Won revenue, pending pipeline, and quote conversion across the selected range."
          />
          <h3 id="monthly-pipeline-trend-heading" className="sr-only">Monthly pipeline trend chart</h3>
          <div className="mt-5">
            {(metrics.monthlyTrend ?? []).length > 1 ? (
              <MonthlyTrendChart data={metrics.monthlyTrend} />
            ) : (
              <EmptySection>At least two months of activity are needed to show a trend.</EmptySection>
            )}
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-5 text-xs text-slate-500" aria-label="Chart legend">
            <Legend color="bg-green-600">Won revenue</Legend>
            <Legend color="bg-blue-600">Pending pipeline</Legend>
            <Legend color="bg-amber-500" line>Conversion rate</Legend>
          </div>
        </section>

        <aside
          data-content-id="needs-attention"
          aria-labelledby="needs-attention-heading"
          className="rounded-2xl bg-amber-50/70 p-5 ring-1 ring-amber-200 sm:p-6"
        >
          <SectionHeader
            title="Needs attention"
            description="The highest-priority actions for the selected period."
          />
          <h3 id="needs-attention-heading" className="sr-only">Needs attention</h3>
          {attentionItems.length > 0 ? (
            <ol className="mt-5 space-y-4">
              {attentionItems.map((item, index) => (
                <li key={item.id} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-semibold text-amber-900">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm leading-6 text-slate-600">
              No urgent pipeline risks are visible in this period.
            </p>
          )}
          <div className="mt-5 border-t border-amber-200 pt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
              Positive signal
            </p>
            <p className="mt-1.5 text-xs leading-5 text-slate-600">
              {getPipelinePositiveSummary(metrics)}
            </p>
          </div>
        </aside>
      </div>

      <section
        data-content-id="pipeline-condition"
        aria-labelledby="pipeline-condition-heading"
        className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
      >
        <SectionHeader
          title="Pipeline condition"
          description="Draft status and the age of the oldest active invoiced quotes in one operating view."
        />
        <h3 id="pipeline-condition-heading" className="sr-only">Pipeline condition</h3>
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)] lg:items-center">
          <div>
            {metrics.totalDrafts > 0 ? (
              <>
                <StatusBreakdownChart
                  open={metrics.openDrafts}
                  invoiceSent={metrics.invoiceSentDrafts}
                  completed={metrics.completedDrafts}
                />
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500" aria-label="Draft status legend">
                  <Legend color="bg-slate-400">Open ({metrics.openDrafts})</Legend>
                  <Legend color="bg-blue-600">Invoice sent ({metrics.invoiceSentDrafts})</Legend>
                  <Legend color="bg-green-600">Completed ({metrics.completedDrafts})</Legend>
                </div>
              </>
            ) : (
              <EmptySection>No quote activity is available for this period.</EmptySection>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
              Aging signal
            </p>
            {oldestActiveBucket ? (
              <>
                <p className="mt-2 text-lg font-semibold text-slate-900">{oldestActiveBucket.label}</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  {oldestActiveBucket.drafts} active {oldestActiveBucket.drafts === 1 ? "quote" : "quotes"} worth {formatMoneyFull(oldestActiveBucket.value)} sit in the oldest populated age band.
                </p>
                <p className="mt-2 text-xs text-slate-400">Detailed aging and weighted value appear in Forecast.</p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-5 text-slate-600">No invoiced quotes are currently aging.</p>
            )}
          </div>
        </div>
      </section>

      <section
        data-content-id="channel-snapshot"
        aria-labelledby="channel-snapshot-heading"
        className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
      >
        <SectionHeader
          title="Quote versus direct revenue"
          description="A concise view of paid revenue influenced by a team quote compared with direct online sales."
          action={<InfoTip text="Quote revenue comes from paid orders linked to draft orders. Direct revenue comes from paid online orders without a linked quote." />}
        />
        <h3 id="channel-snapshot-heading" className="sr-only">Quote versus direct revenue</h3>
        {channel.totalOrders > 0 ? (
          <div className="mt-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ChannelMetric label="Total revenue" value={formatMoney(channel.totalRevenue)} detail={`${channel.totalOrders} orders`} />
              <ChannelMetric label="From quotes" value={formatMoney(channel.draftRevenue)} detail={`${channel.draftOrders} orders, ${formatMoney(channel.draftAOV)} average`} tone="purple" />
              <ChannelMetric label="Direct online" value={formatMoney(channel.directRevenue)} detail={`${channel.directOrders} orders, ${formatMoney(channel.directAOV)} average`} tone="slate" />
            </div>
            <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
              <div className="bg-purple-500" style={{ width: `${channel.draftRevenueShare}%` }} />
              <div className="bg-slate-500" style={{ width: `${directShare}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>Quotes {formatPercent(channel.draftRevenueShare)}</span>
              <span>Direct {formatPercent(directShare)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-5"><EmptySection>No paid order channel data is available for this period.</EmptySection></div>
        )}
      </section>
    </div>
  );
}

function FlowStage({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "slate" | "green" | "blue";
}) {
  const classes = {
    slate: "bg-slate-900 text-white",
    green: "bg-green-50 text-green-800 ring-1 ring-green-200",
    blue: "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
  }[tone];

  return (
    <div className={`rounded-2xl px-5 py-5 ${classes}`}>
      <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${tone === "slate" ? "text-slate-300" : "opacity-70"}`}>{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      <p className={`mt-1 text-xs ${tone === "slate" ? "text-slate-300" : "opacity-70"}`}>{detail}</p>
    </div>
  );
}

function FlowArrow() {
  return (
    <span className="flex items-center justify-center py-1 text-lg text-slate-300" aria-hidden="true">
      <span className="sm:hidden">↓</span>
      <span className="hidden sm:inline">→</span>
    </span>
  );
}

function InfoLabel({ text, children }: { text: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <InfoTip text={text} />
    </span>
  );
}

function Legend({ color, line, children }: { color: string; line?: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`${color} ${line ? "h-0.5 w-5" : "h-2.5 w-2.5 rounded-sm"}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function ChannelMetric({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "slate" | "purple";
}) {
  return (
    <div className="min-w-0">
      <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${tone === "purple" ? "text-purple-600" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "purple" ? "text-purple-700" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
