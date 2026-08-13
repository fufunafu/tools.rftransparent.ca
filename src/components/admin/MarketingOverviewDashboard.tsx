"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatCADShort } from "@/lib/format";
import type { Result, SalesByStore } from "@/lib/ops-dashboard";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { CardShell, Stat, Unavailable, num, pct } from "@/components/admin/dashboard/widgets";
import { DashboardPane } from "@/components/admin/dashboard/DashboardPane";
import { DashboardSwitcher } from "@/components/admin/dashboard/DashboardSwitcher";
import { SalesSection } from "@/components/admin/dashboard/SalesSection";
import {
  AdSpendChart,
  ConversionsChart,
  ProfitChart,
  RevenueSpendPanels,
  RoasChart,
  type DerivedPoint,
} from "@/components/admin/MarketingCharts";

// One-screen marketing daily summary over a fixed 30-day window. The deep
// dive (tabs, custom ranges, search terms) stays on /marketing — this page
// answers "how are the ads doing" at a glance. Ads data is fetched client-
// side from the same /api/marketing endpoint the Marketing page uses; sales
// context arrives server-fetched via props.

const REPORT_TZ = "America/Toronto";

interface AdMetrics {
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
  ads_revenue?: number;
  google_roas?: number;
  order_count: number;
}

interface MarketingSummary {
  current: AdMetrics;
  previous: AdMetrics;
}

interface DailyPoint {
  date: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
  ads_revenue?: number;
  google_roas?: number;
  order_count: number;
  sessions?: number;
}

function dayStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("en-CA", { timeZone: REPORT_TZ });
}

// The MarketingCharts components size to their parent (height="100%"), so
// each needs a fixed-height body or it collapses to nothing.
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
      <div className="px-4 py-[7px] border-b border-slate-100">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</span>
      </div>
      <div className="h-[220px] px-2 pt-3 pb-1">{children}</div>
    </section>
  );
}

function changePct(current: number, previous: number): string | undefined {
  if (!previous) return undefined;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change)) return undefined;
  return `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}% vs prior 30d`;
}

export default function MarketingOverviewDashboard({
  sales,
  today,
}: {
  sales: Result<SalesByStore>;
  today: string;
}) {
  const [summary, setSummary] = useState<MarketingSummary | null>(null);
  const [history, setHistory] = useState<DailyPoint[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const from = dayStr(29);
    const to = dayStr(0);
    try {
      const [summaryRes, historyRes] = await Promise.all([
        fetch(`/api/marketing?${new URLSearchParams({ from, to })}`),
        fetch(`/api/marketing?${new URLSearchParams({ view: "history", from, to })}`),
      ]);
      if (!summaryRes.ok) {
        const body = await summaryRes.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load marketing data");
      }
      setSummary((await summaryRes.json()) as MarketingSummary);
      if (historyRes.ok) {
        const body = await historyRes.json();
        setHistory(body.history ?? []);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, { intervalMs: 5 * 60_000 });

  // Same derivation as the Marketing page: today excluded (partial day), 7-day
  // moving average for the revenue line.
  const chartData: DerivedPoint[] = useMemo(() => {
    const complete = history.filter((d) => d.date !== dayStr(0));
    return complete.map((d, i) => {
      const window = complete.slice(Math.max(0, i - 6), i + 1);
      const ma7 = window.reduce((s, w) => s + w.revenue, 0) / window.length;
      return {
        ...d,
        cpc: d.clicks > 0 ? Math.round((d.ad_spend / d.clicks) * 100) / 100 : 0,
        ctr: d.impressions > 0 ? Math.round((d.clicks / d.impressions) * 10000) / 100 : 0,
        profit: Math.round((d.revenue - d.ad_spend) * 100) / 100,
        aov: d.order_count > 0 ? Math.round((d.revenue / d.order_count) * 100) / 100 : 0,
        revenue_ma7: Math.round(ma7 * 100) / 100,
      };
    });
  }, [history]);

  const avgs = useMemo(() => {
    const n = chartData.length || 1;
    const avg = (fn: (d: DerivedPoint) => number) =>
      Math.round((chartData.reduce((s, d) => s + fn(d), 0) / n) * 100) / 100;
    const totalSpend = chartData.reduce((s, d) => s + d.ad_spend, 0);
    const totalRevenue = chartData.reduce((s, d) => s + d.revenue, 0);
    return {
      ad_spend: avg((d) => d.ad_spend),
      conversions: avg((d) => d.conversions),
      profit: avg((d) => d.profit),
      roas: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0,
    };
  }, [chartData]);

  const cur = summary?.current;
  const prev = summary?.previous;

  return (
    <DashboardPane>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Marketing</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5">{today} · last 30 days</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/marketing"
            className="h-7 inline-flex items-center gap-1.5 px-2.5 border border-slate-200 rounded-lg bg-white text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            Full analysis →
          </Link>
          <DashboardSwitcher current="/dashboards/marketing" />
        </div>
      </div>

      {error ? (
        <Unavailable label="Google Ads" error={error} />
      ) : (
        <CardShell label="Google Ads · last 30 days" note={loading ? "loading…" : "vs prior 30 days"}>
          <Stat
            label="Ad spend"
            value={cur ? formatCADShort(cur.ad_spend) : "—"}
            sub={cur && prev ? changePct(cur.ad_spend, prev.ad_spend) : undefined}
            dataLabel="Ad spend"
            calc="Google Ads cost over the last 30 days."
            src="Google Ads API"
          />
          <Stat
            label="Revenue"
            value={cur ? formatCADShort(cur.revenue) : "—"}
            sub={cur && prev ? changePct(cur.revenue, prev.revenue) : undefined}
            dataLabel="Revenue"
            calc="Shopify revenue over the same 30-day window the ads ran in."
            src="Shopify Admin API · orders"
          />
          <Stat
            label="ROAS"
            value={cur ? `${cur.roas.toFixed(2)}×` : "—"}
            sub={cur?.google_roas != null ? `Google-attributed ${cur.google_roas.toFixed(2)}×` : undefined}
            dataLabel="ROAS"
            calc="Total revenue ÷ ad spend over the last 30 days. The sub-line is Google's own conversion-attributed ROAS."
            src="Google Ads API + Shopify"
          />
          <Stat
            label="Conversions"
            value={cur ? num(Math.round(cur.conversions)) : "—"}
            sub={cur && prev ? changePct(cur.conversions, prev.conversions) : undefined}
            dataLabel="Conversions"
            calc="Google Ads conversions over the last 30 days."
            src="Google Ads API"
          />
          <Stat
            label="Clicks"
            value={cur ? num(cur.clicks) : "—"}
            sub={cur ? `${num(cur.impressions)} impressions` : undefined}
            dataLabel="Clicks"
            calc="Google Ads clicks and impressions over the last 30 days."
            src="Google Ads API"
          />
          <Stat
            label="Cost per click"
            value={cur && cur.clicks > 0 ? `$${(cur.ad_spend / cur.clicks).toFixed(2)}` : "—"}
            sub={
              cur && cur.impressions > 0
                ? `${pct((cur.clicks / cur.impressions) * 100, 2)} CTR`
                : undefined
            }
            dataLabel="Cost per click"
            calc="Ad spend ÷ clicks; the sub-line is clicks ÷ impressions."
            src="Google Ads API"
          />
        </CardShell>
      )}

      {chartData.length > 0 && (
        <>
          <RevenueSpendPanels data={chartData} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ChartCard title="ROAS">
              <RoasChart data={chartData} avg={avgs.roas} />
            </ChartCard>
            <ChartCard title="Ad spend">
              <AdSpendChart data={chartData} avg={avgs.ad_spend} />
            </ChartCard>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ChartCard title="Conversions">
              <ConversionsChart data={chartData} avg={avgs.conversions} />
            </ChartCard>
            <ChartCard title="Daily profit (revenue − spend)">
              <ProfitChart data={chartData} avg={avgs.profit} />
            </ChartCard>
          </div>
        </>
      )}

      {sales.ok ? (
        <SalesSection sales={sales.value.stores} />
      ) : (
        <Unavailable label="Sales by store" error={sales.error} />
      )}
    </DashboardPane>
  );
}
