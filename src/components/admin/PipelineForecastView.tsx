"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { PipelineData } from "./PipelineDashboard.types";
import {
  EmptySection,
  formatMoney,
  formatPercent,
  InfoTip,
  MetricCard,
  SectionHeader,
  StatusPill,
} from "./PipelineDashboardPrimitives";
import { getForecastConfidence } from "@/lib/pipeline-dashboard-view";

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

const ForecastChart = dynamic(
  () => import("./PipelineCharts").then((module) => module.ForecastChart),
  { ssr: false, loading: () => <ChartLoading height={320} /> },
);

const SeasonalPatternChart = dynamic(
  () => import("./PipelineCharts").then((module) => module.SeasonalPatternChart),
  { ssr: false, loading: () => <ChartLoading height={240} /> },
);

const TRANSITION_LABELS = [
  "Dec→Jan",
  "Jan→Feb",
  "Feb→Mar",
  "Mar→Apr",
  "Apr→May",
  "May→Jun",
  "Jun→Jul",
  "Jul→Aug",
  "Aug→Sep",
  "Sep→Oct",
  "Oct→Nov",
  "Nov→Dec",
];

export default function PipelineForecastView({
  data,
  storeId,
  onRecalculate,
}: {
  data: PipelineData;
  storeId: string;
  onRecalculate: () => Promise<void>;
}) {
  const prediction = data.prediction;
  const forecasts = prediction?.monthlyForecasts ?? [];
  const buckets = prediction?.buckets ?? [];
  const seasonalHistory = prediction?.seasonalPattern ?? [];
  const confidence = getForecastConfidence({
    monthlyForecasts: forecasts,
    seasonalPattern: seasonalHistory,
  });
  const visiblePipeline = forecasts.reduce((sum, month) => sum + month.fromPipeline, 0);
  const activeSeasonalMonths = seasonalHistory.filter((month) => month.revenue > 0);
  const seasonalChartData = activeSeasonalMonths.map((month, index) => ({
    ...month,
    momGrowthClamped:
      index === 0 || month.momGrowth === null
        ? null
        : Math.max(-100, Math.min(100, month.momGrowth)),
  }));

  return (
    <div className="space-y-8">
      <section aria-labelledby="forecast-summary-heading">
        <SectionHeader
          id="forecast-summary-heading"
          title="Forecast outlook"
          description="A management view of expected revenue, the pipeline already visible, and the strength of the underlying history."
        />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div data-content-id="annual-forecast">
            <MetricCard
              label="Annual forecast"
              value={formatMoney(prediction.annualForecast)}
              detail={`${formatMoney(prediction.avgMonthlyRevenue)} average per month`}
              tone="blue"
            />
          </div>
          <div data-content-id="weighted-pipeline">
            <MetricCard
              label="Weighted pipeline"
              value={formatMoney(prediction.totalPredictedRevenue)}
              detail={`${formatMoney(prediction.totalPipelineValue)} currently visible`}
              tone="purple"
            />
          </div>
          <div data-content-id="starting-revenue">
            <MetricCard
              label="Starting revenue"
              value={formatMoney(prediction.startingRevenue)}
              detail={`${prediction.startingMonth || "Latest month"} actual revenue`}
              tone="green"
            />
          </div>
          <div data-content-id="forecast-confidence" className="border-t-2 border-blue-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Forecast confidence</p>
            <div className="mt-2">
              <StatusPill tone={confidence.level === "High" ? "green" : confidence.level === "Moderate" ? "blue" : "amber"}>
                {confidence.level}
              </StatusPill>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{confidence.detail}</p>
          </div>
        </div>
      </section>

      <section
        data-content-id="monthly-forecast"
        aria-labelledby="monthly-forecast-heading"
        className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
      >
        <SectionHeader
          id="monthly-forecast-heading"
          title="Monthly revenue forecast"
          description="Actual revenue establishes the baseline. Projected revenue extends it, while the purple line shows pipeline already visible today."
          action={<InfoTip text="Forecast bars apply historical month-over-month growth to the latest completed month. The visible pipeline line is the win-rate-weighted portion of current invoiced quotes expected in each month." />}
        />
        <div className="mt-5">
          {forecasts.length > 0 ? (
            <ForecastChart
              data={forecasts}
              startingMonth={prediction.startingMonth}
              startingRevenue={prediction.startingRevenue}
            />
          ) : (
            <EmptySection>No monthly forecast is available for the selected period.</EmptySection>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-5 text-xs text-slate-500" aria-label="Chart legend">
          <Legend color="bg-green-600">Actual revenue</Legend>
          <Legend color="bg-blue-600">Projected revenue</Legend>
          <Legend color="bg-purple-600" line>Already-visible pipeline</Legend>
        </div>
        {visiblePipeline > 0 && (
          <p className="mt-3 text-center text-xs text-slate-400">
            {formatMoney(visiblePipeline)} of weighted pipeline is distributed across the forecast months.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section
          data-content-id="pipeline-aging"
          aria-labelledby="pipeline-aging-heading"
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
        >
          <SectionHeader
            id="pipeline-aging-heading"
            title="Pipeline aging"
            description="The expected value of invoiced quotes by time since invoice."
          />
          {buckets.length > 0 ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">Invoice age</th>
                    <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Quotes</th>
                    <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Value</th>
                    <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Win rate</th>
                    <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Weighted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {buckets.map((bucket) => (
                    <tr key={bucket.label}>
                      <td className="py-2.5 font-medium text-slate-800">{bucket.label}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">{bucket.drafts}</td>
                      <td className="py-2.5 text-right tabular-nums text-blue-700">{formatMoney(bucket.value)}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">{formatPercent(bucket.conversionRate)}</td>
                      <td className="py-2.5 text-right font-medium tabular-nums text-purple-700">{formatMoney(bucket.predictedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-5"><EmptySection>No invoiced pipeline is currently aging.</EmptySection></div>
          )}
        </section>

        <section
          data-content-id="seasonal-history"
          aria-labelledby="seasonal-history-heading"
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:p-6"
        >
          <SectionHeader
            id="seasonal-history-heading"
            title="Seasonal history"
            description="Actual monthly revenue and the historical change used to inform future months."
            action={<InfoTip text="The amber line is limited to plus or minus 100 percent in the chart for readability. Forecast calculations still use their documented cap." />}
          />
          <div className="mt-5">
            {seasonalChartData.length > 2 ? (
              <SeasonalPatternChart data={seasonalChartData} />
            ) : (
              <EmptySection>More historical months are needed to show a seasonal pattern.</EmptySection>
            )}
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-5 text-xs text-slate-500" aria-label="Chart legend">
            <Legend color="bg-green-600">Actual revenue</Legend>
            <Legend color="bg-amber-500" line>Month-over-month change</Legend>
          </div>
        </section>
      </div>

      <details
        data-content-id="forecast-assumptions"
        className="group rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-5 text-sm font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:px-6">
          <span>
            Forecast assumptions
            <span className="mt-1 block text-xs font-normal text-slate-500">Methodology, month-by-month calculations, and fallback rates</span>
          </span>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </summary>
        <div className="border-t border-slate-100 px-5 py-6 sm:px-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.4fr)]">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Seasonal month-over-month compounding</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-slate-600">
                <li>Start with {prediction.startingMonth || "the latest completed month"} actual revenue of {formatMoney(prediction.startingRevenue)}.</li>
                <li>Apply the prior year&apos;s growth rate for each future month transition.</li>
                <li>Limit extreme month-over-month rates to &plusmn;200%.</li>
                <li>Use the configured fallback rate when historical data is unavailable.</li>
              </ol>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 text-left font-medium text-slate-500">Month</th>
                    <th className="pb-2 text-right font-medium text-slate-500">Previous month</th>
                    <th className="pb-2 text-right font-medium text-slate-500">Growth rate</th>
                    <th className="pb-2 text-right font-medium text-slate-500">Projected</th>
                    <th className="pb-2 text-right font-medium text-slate-500">Visible pipeline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {forecasts.map((forecast) => (
                    <tr key={forecast.month}>
                      <td className="py-2 text-slate-700">
                        {forecast.monthLabel}
                        {forecast.isFallback && <span className="ml-1 text-amber-600" title="Fallback growth rate used">*</span>}
                        {forecast.momRateCapped && <span className="ml-1 text-red-500" title="Growth rate capped">!</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{formatMoney(forecast.prevMonthRevenue)}</td>
                      <td className={`py-2 text-right font-medium tabular-nums ${forecast.momRate >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {forecast.momRate >= 0 ? "+" : ""}{Math.round(forecast.momRate * 100)}%
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums text-blue-700">{formatMoney(forecast.forecast)}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-purple-700">{forecast.fromPipeline > 0 ? formatMoney(forecast.fromPipeline) : "None"}</td>
                    </tr>
                  ))}
                  {forecasts.length > 0 && (
                    <tr className="border-t-2 border-slate-200">
                      <td colSpan={3} className="py-2 font-semibold text-slate-900">12-month total</td>
                      <td className="py-2 text-right font-semibold text-blue-800">{formatMoney(prediction.annualForecast)}</td>
                      <td className="py-2 text-right font-semibold text-purple-800">{formatMoney(visiblePipeline)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
                {forecasts.some((forecast) => forecast.isFallback) && <span>* Fallback rate used</span>}
                {forecasts.some((forecast) => forecast.momRateCapped) && <span>! Rate capped at &plusmn;200%</span>}
              </div>
            </div>
          </div>
          <FallbackRatesEditor
            rates={prediction.fallbackMomRates}
            storeId={storeId}
            onSaved={onRecalculate}
          />
        </div>
      </details>
    </div>
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

function FallbackRatesEditor({
  rates,
  storeId,
  onSaved,
}: {
  rates: Record<number, number>;
  storeId: string;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    const nextDraft: Record<number, string> = {};
    for (let index = 0; index < 12; index += 1) {
      nextDraft[index] = String(Math.round((rates[index] ?? 0) * 100));
    }
    setDraft(nextDraft);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const nextRates: Record<string, number> = {};
    for (let index = 0; index < 12; index += 1) {
      nextRates[index] = (Number.parseFloat(draft[index]) || 0) / 100;
    }

    try {
      const response = await fetch("/api/settings/forecast-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: nextRates, storeId }),
      });
      if (!response.ok) throw new Error(response.status === 403 ? "forbidden" : "save-failed");
      setEditing(false);
      await onSaved();
    } catch (error) {
      window.alert(
        error instanceof Error && error.message === "forbidden"
          ? "Only admins can change forecast rates."
          : "Forecast rates could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Seasonal fallback rates</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Used when Shopify history is missing for a month transition. Select one store to edit its rates.
          </p>
        </div>
        {!editing ? (
          storeId !== "all" && (
            <button type="button" onClick={startEditing} className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
              Edit rates
            </button>
          )
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save and recalculate"}
            </button>
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <label key={TRANSITION_LABELS[index]} className="flex items-center justify-between gap-2 text-slate-600">
            <span>{TRANSITION_LABELS[index]}</span>
            {editing ? (
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  aria-label={`${TRANSITION_LABELS[index]} fallback rate`}
                  value={draft[index] ?? "0"}
                  onChange={(event) => setDraft((value) => ({ ...value, [index]: event.target.value }))}
                  className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-right text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <span>%</span>
              </span>
            ) : (
              <span className={`font-medium ${(rates[index] ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>
                {(rates[index] ?? 0) >= 0 ? "+" : ""}{Math.round((rates[index] ?? 0) * 100)}%
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
