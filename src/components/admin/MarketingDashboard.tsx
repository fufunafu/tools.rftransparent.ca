"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { mktCacheSave, mktCacheLoad, mktCacheClearAll } from "@/lib/marketing-cache";
import CampaignsTab from "./marketing/CampaignsTab";
import AudienceTab from "./marketing/AudienceTab";
import SearchTermsTab from "./marketing/SearchTermsTab";
import AnalysisTab from "./marketing/AnalysisTab";

type Range = "7d" | "30d" | "60d" | "100d" | "365d" | "2y" | "custom";
type Tab = "overview" | "campaigns" | "audience" | "search" | "analysis";

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

interface MarketingResponse {
  current: AdMetrics;
  previous: AdMetrics;
  change: Record<string, number | null>;
  period: string;
  demo?: boolean;
  dateRange: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
  };
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

interface DerivedPoint extends DailyPoint {
  cpc: number;
  ctr: number;
  profit: number;
  aov: number;
  revenue_ma7: number;
}

// Business dates are America/Toronto (matches the Google Ads account timezone),
// regardless of the viewer's or server's clock.
const REPORT_TZ = "America/Toronto";

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: REPORT_TZ });
}

function daysAgoStr(n: number) {
  const d = new Date(todayStr() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

// Monday of the week containing the given date, as YYYY-MM-DD
function weekStartStr(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().split("T")[0];
}

interface SearchTermLite {
  term: string;
  ad_spend: number;
  conversions: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCurrency2(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

function formatPct(n: number) {
  return `${n.toFixed(2)}%`;
}

// Compact currency for chart axes: $80000 -> $80k
function formatAxisCurrency(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1000) return `$${(v / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `$${v}`;
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sand-300">--</span>;
  const isPositive = value > 0;
  const isNegative = value < 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium ${
        isPositive
          ? "text-green-700"
          : isNegative
            ? "text-red-600"
            : "text-sand-400"
      }`}
    >
      {isPositive ? "+" : ""}
      {value}%
    </span>
  );
}

const METRICS: {
  key: keyof AdMetrics;
  label: string;
  format: (v: number) => string;
}[] = [
  { key: "revenue", label: "Revenue", format: formatCurrency },
  { key: "ad_spend", label: "Ad Spend", format: formatCurrency },
  { key: "roas", label: "Blended ROAS", format: (v) => `${v}x` },
  { key: "clicks", label: "Clicks", format: formatNumber },
  { key: "impressions", label: "Impressions", format: formatNumber },
  { key: "conversions", label: "Conversions", format: formatNumber },
];

interface DerivedMetric {
  label: string;
  key: string;
  compute: (d: AdMetrics) => number;
  format: (v: number) => string;
  change: (cur: AdMetrics, prev: AdMetrics) => number | null;
}

const DERIVED_METRICS: DerivedMetric[] = [
  {
    label: "Google ROAS",
    key: "google_roas",
    compute: (d) => d.google_roas ?? 0,
    format: (v) => `${v.toFixed(2)}x`,
    change: (c, p) => {
      const cur = c.google_roas ?? 0;
      const prev = p.google_roas ?? 0;
      return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    },
  },
  {
    label: "Orders",
    key: "order_count",
    compute: (d) => d.order_count,
    format: formatNumber,
    change: (c, p) => p.order_count > 0 ? Math.round(((c.order_count - p.order_count) / p.order_count) * 100) : null,
  },
  {
    label: "CPC",
    key: "cpc",
    compute: (d) => d.clicks > 0 ? d.ad_spend / d.clicks : 0,
    format: formatCurrency2,
    change: (c, p) => {
      const cur = c.clicks > 0 ? c.ad_spend / c.clicks : 0;
      const prev = p.clicks > 0 ? p.ad_spend / p.clicks : 0;
      return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    },
  },
  {
    label: "CTR",
    key: "ctr",
    compute: (d) => d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
    format: formatPct,
    change: (c, p) => {
      const cur = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
      const prev = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
      return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    },
  },
  {
    label: "Profit",
    key: "profit",
    compute: (d) => d.revenue - d.ad_spend,
    format: formatCurrency,
    change: (c, p) => {
      const cur = c.revenue - c.ad_spend;
      const prev = p.revenue - p.ad_spend;
      return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    },
  },
  {
    label: "AOV",
    key: "aov",
    compute: (d) => d.order_count > 0 ? d.revenue / d.order_count : 0,
    format: formatCurrency2,
    change: (c, p) => {
      const cur = c.order_count > 0 ? c.revenue / c.order_count : 0;
      const prev = p.order_count > 0 ? p.revenue / p.order_count : 0;
      return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    },
  },
];

function formatShortDate(label: unknown) {
  const dateStr = String(label);
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        className="w-4 h-4 rounded-full bg-sand-200/80 text-sand-500 hover:bg-sand-300 hover:text-sand-700 transition-colors inline-flex items-center justify-center text-[10px] font-bold leading-none"
        aria-label="Info"
      >
        ?
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-sand-900 text-sand-100 text-xs leading-relaxed p-3 shadow-lg">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-sand-900" />
        </div>
      )}
    </span>
  );
}

const CHART_INFO: Record<string, string> = {
  "Revenue vs Ad Spend":
    "Two aligned panels sharing the same dates: total store revenue (Shopify) on top with a 7-day average trend line, and Google Ads spend below on its own scale (spend is much smaller than revenue, so it gets its own panel to stay readable). On ranges over ~2 months, charts switch to weekly totals so trends stay readable. Look for spend changes followed by revenue changes shortly after.",
  "Ad Spend":
    "Daily Google Ads spend across all campaigns. Track spending trends to spot budget fluctuations and correlate with revenue changes.",
  ROAS:
    "Two ways of measuring return on ad spend. Blended (also called MER) = ALL store revenue / ad spend — includes organic, repeat, and direct sales, so it overstates what ads alone earn. Google ROAS uses only revenue that Google's conversion tracking attributes to ad clicks — more conservative, closer to the ads' true return. The truth is usually between the two.",
  Conversions:
    "A conversion is tracked by Google Ads when someone completes a desired action (e.g. a purchase or form submission) after clicking your ad.",
  Clicks:
    "Total number of times people clicked on your Google Ads. More clicks with the same budget means your ads are more appealing to viewers.",
  CPC:
    "Cost Per Click = Ad Spend / Clicks. Shows how much you pay on average for each click on your ads. Lower is better — it means you're getting more traffic for the same budget.",
  CTR:
    "Click-Through Rate = Clicks / Impressions. Shows what percentage of people who see your ad actually click it. Higher CTR means your ads are more compelling.",
  Profit:
    "Profit = Revenue - Ad Spend. When the line is above zero (green zone), your ads are generating more revenue than they cost. Below zero means ads are losing money.",
  AOV:
    "Average Order Value = Revenue / Orders. Shows how much each customer spends on average. Higher AOV means each sale is worth more.",
  "Order Count":
    "Number of orders placed per day in the Glass Railing Store. This shows purchasing activity trends over time.",
  "Impressions vs Visits":
    "Impressions (blue) show how many times your Google Ads were displayed. Website visits/sessions (green) show actual traffic to your site from Google Analytics. The gap between them shows how many people see your ads vs actually visit your site.",
};

const METRIC_INFO: Record<string, string> = {
  revenue: "Total sales from the Glass Railing Store (Shopify) during this period.",
  ad_spend: "Total amount spent on Google Ads campaigns during this period.",
  roas: "Blended ROAS (also called MER) = ALL store revenue / ad spend. Includes organic, repeat, and direct sales — not just orders from ads — so it overstates what ads alone earn. Compare with Google ROAS below.",
  google_roas: "Google ROAS = ad-attributed revenue / ad spend, using only orders Google's conversion tracking credits to ad clicks. More conservative than Blended ROAS; the ads' true return is usually between the two.",
  clicks: "Number of times people clicked on your Google Ads.",
  impressions: "Number of times your ads were shown to people. Not all impressions lead to clicks.",
  conversions: "Actions completed after clicking your ad, as tracked by Google Ads conversion tags.",
  order_count: "Total number of orders placed in the Glass Railing Store during this period.",
  cpc: "Cost Per Click = Ad Spend / Clicks. Average cost for each ad click.",
  ctr: "Click-Through Rate = Clicks / Impressions. Percentage of ad viewers who clicked.",
  profit: "Profit = Revenue - Ad Spend. Net earnings after advertising costs.",
  aov: "Average Order Value = Revenue / Orders. Average revenue per order.",
};

function LegendDot({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-sand-500">
      {line ? (
        <span className="w-3.5 h-0.5 rounded-full" style={{ background: color }} />
      ) : (
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}

const tooltipStyle = {
  contentStyle: {
    background: "#faf9f7",
    border: "1px solid #e5e0d8",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

function ChartModal({
  title,
  legend,
  onClose,
  children,
}: {
  title: string;
  legend?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-sand-900/50 flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-full overflow-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-sand-700 uppercase tracking-wider">{title}</p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-sand-200 text-sand-600 hover:bg-sand-50 transition-colors"
          >
            Close
          </button>
        </div>
        {legend && <div className="flex flex-wrap gap-4 mb-3">{legend}</div>}
        {children}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  chartKey,
  avg,
  legend,
  children,
}: {
  title: string;
  chartKey: string;
  avg?: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <p className="text-xs text-sand-400 uppercase tracking-wider">
            {title}
          </p>
          {CHART_INFO[chartKey] && <InfoTooltip text={CHART_INFO[chartKey]} />}
        </div>
        {avg && (
          <span className="text-xs text-sand-500 font-medium">
            avg: <span className="text-sand-700">{avg}</span>
          </span>
        )}
      </div>
      {legend && <div className="flex flex-wrap gap-4 mb-3 -mt-2">{legend}</div>}
      <div
        className="h-52 cursor-zoom-in"
        title="Click to enlarge"
        onClick={() => setExpanded(true)}
      >
        {children}
      </div>
      {expanded && (
        <ChartModal title={title} legend={legend} onClose={() => setExpanded(false)}>
          <div className="h-[70vh]">{children}</div>
        </ChartModal>
      )}
    </div>
  );
}

// The two aligned Revenue / Ad Spend panels. Rendered small inside the card
// and large inside the expand modal, so heights are parameterized.
function RevenueSpendPanels({ data, big, weekly }: { data: DerivedPoint[]; big?: boolean; weekly?: boolean }) {
  const label = (l: unknown) => (weekly ? `Week of ${formatShortDate(l)}` : formatShortDate(l));
  return (
    <>
      <div className={big ? "h-[46vh]" : "h-32"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16a34a" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
            <XAxis dataKey="date" hide />
            <YAxis width={44} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
            <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value)), name === "revenue" ? "Revenue" : "7-day avg"]} />
            <Area type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={weekly ? 2 : 1.5} strokeOpacity={weekly ? 1 : 0.6} fill="url(#gradRevenue)" />
            {!weekly && <Line type="monotone" dataKey="revenue_ma7" stroke="#166534" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#166534" }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={big ? "h-[20vh] mt-2" : "h-24 mt-1"}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradSpendPanel" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dc2626" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
            <YAxis width={44} tick={{ fontSize: 10, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} tickCount={big ? 5 : 3} />
            <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatCurrency(Number(value)), "Ad Spend"]} />
            <Area type="monotone" dataKey="ad_spend" stroke="#dc2626" strokeWidth={2} fill="url(#gradSpendPanel)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function RevenueSpendCard({
  data,
  avgRev,
  avgSpend,
  rangeLabel,
  weekly,
}: {
  data: DerivedPoint[];
  avgRev: number;
  avgSpend: number;
  rangeLabel: string;
  weekly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = `Revenue & Ad Spend (${rangeLabel})`;
  const legend = (
    <>
      <LegendDot color="#16a34a" label={weekly ? "Revenue (weekly)" : "Revenue (daily)"} />
      {!weekly && <LegendDot color="#166534" label="7-day avg" line />}
      <LegendDot color="#dc2626" label="Ad spend (own scale)" />
    </>
  );
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <p className="text-xs text-sand-400 uppercase tracking-wider">{title}</p>
          <InfoTooltip text={CHART_INFO["Revenue vs Ad Spend"]} />
        </div>
        <span className="text-xs text-sand-500 font-medium">
          avg/{weekly ? "week" : "day"}: <span className="text-sand-700">{formatCurrency(avgRev)} rev / {formatCurrency(avgSpend)} spend</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-4 mb-2">{legend}</div>
      <div className="cursor-zoom-in" title="Click to enlarge" onClick={() => setExpanded(true)}>
        <RevenueSpendPanels data={data} weekly={weekly} />
      </div>
      {expanded && (
        <ChartModal title={title} legend={legend} onClose={() => setExpanded(false)}>
          <RevenueSpendPanels data={data} big weekly={weekly} />
        </ChartModal>
      )}
    </div>
  );
}

function InsightsPanel({
  data,
  history,
  days,
  terms,
}: {
  data: MarketingResponse;
  history: DailyPoint[];
  days: number;
  terms?: SearchTermLite[];
}) {
  const c = data.current;
  const insights: { icon: string; text: string; color: string }[] = [];

  // Wasted spend — search terms that cost real money and converted nothing
  if (terms && terms.length > 0) {
    const wasteful = terms
      .filter((t) => t.ad_spend > 50 && t.conversions === 0)
      .sort((a, b) => b.ad_spend - a.ad_spend);
    if (wasteful.length > 0) {
      const totalWaste = wasteful.reduce((s, t) => s + t.ad_spend, 0);
      const top = wasteful
        .slice(0, 3)
        .map((t) => `"${t.term}" (${formatCurrency(t.ad_spend)})`)
        .join(", ");
      insights.push({
        icon: "!",
        color: "text-red-600",
        text: `${formatCurrency(totalWaste)} went to ${wasteful.length} search term${wasteful.length === 1 ? "" : "s"} with zero conversions. Biggest: ${top}. Consider adding these as negative keywords — see the Search Terms tab.`,
      });
    }
  }

  // ROAS explanation — assess on Google-attributed ROAS when available, since
  // blended ROAS includes revenue the ads didn't generate
  if (c.roas > 0) {
    const attributed = c.google_roas ?? 0;
    const assessOn = attributed > 0 ? attributed : c.roas;
    const roasColor = assessOn >= 3 ? "text-green-700" : assessOn >= 1 ? "text-amber-700" : "text-red-600";
    insights.push({
      icon: assessOn >= 3 ? "+" : assessOn >= 1 ? "~" : "!",
      color: roasColor,
      text: `Blended ROAS is ${c.roas}x — every $1 of ad spend coincided with $${c.roas.toFixed(2)} in total store revenue (all sources, not just ads).${
        attributed > 0
          ? ` Google's conversion tracking attributes ${attributed.toFixed(2)}x directly to ad clicks.`
          : ""
      }${
        assessOn >= 3
          ? " That attributed return is strong."
          : assessOn >= 1
            ? " The attributed return is around break-even. Consider optimizing ad targeting."
            : " Ads are earning back less than they cost by Google's attribution. Review underperforming campaigns."
      }`,
    });
  }

  // Profit / loss
  const profit = c.revenue - c.ad_spend;
  if (c.ad_spend > 0) {
    insights.push({
      icon: profit > 0 ? "+" : "-",
      color: profit > 0 ? "text-green-700" : "text-red-600",
      text: profit > 0
        ? `Net profit of ${formatCurrency(profit)} after ad spend over this period.`
        : `Net loss of ${formatCurrency(Math.abs(profit))} — ad spend exceeded revenue by ${formatCurrency(Math.abs(profit))}.`,
    });
  }

  // Cost per conversion
  if (c.conversions > 0 && c.ad_spend > 0) {
    const costPerConv = c.ad_spend / c.conversions;
    insights.push({
      icon: "$",
      color: "text-sand-700",
      text: `Each conversion costs ${formatCurrency(costPerConv)} on average. ${
        c.revenue > 0
          ? `Average order value is ${formatCurrency(c.revenue / c.conversions)}, so each sale nets ${formatCurrency((c.revenue / c.conversions) - costPerConv)} after ad cost.`
          : ""
      }`,
    });
  }

  // CTR assessment
  if (c.impressions > 0) {
    const ctr = (c.clicks / c.impressions) * 100;
    insights.push({
      icon: "%",
      color: ctr >= 2 ? "text-green-700" : ctr >= 1 ? "text-amber-700" : "text-sand-500",
      text: `Click-through rate is ${ctr.toFixed(2)}%. ${
        ctr >= 3
          ? "Excellent — your ads are highly relevant to viewers."
          : ctr >= 1.5
            ? "Solid CTR. Your ad copy and targeting are working."
            : ctr >= 0.5
              ? "Average CTR. Test different headlines or audiences to improve."
              : "Low CTR. Your ads may not be reaching the right audience, or the creative needs refreshing."
      }`,
    });
  }

  // CPC insight
  if (c.clicks > 0 && c.ad_spend > 0) {
    const cpc = c.ad_spend / c.clicks;
    insights.push({
      icon: "$",
      color: cpc <= 2 ? "text-green-700" : cpc <= 5 ? "text-amber-700" : "text-red-600",
      text: `Cost per click is ${formatCurrency2(cpc)}. ${
        cpc <= 2 ? "Very efficient — you're getting cheap traffic." : cpc <= 5 ? "Reasonable CPC for this industry." : "High CPC — consider refining keywords or audiences to lower costs."
      }`,
    });
  }

  // AOV insight
  if (c.order_count > 0 && c.revenue > 0) {
    const aov = c.revenue / c.order_count;
    insights.push({
      icon: "#",
      color: "text-sand-700",
      text: `Average order value is ${formatCurrency2(aov)} across ${c.order_count} orders. ${
        aov >= 500 ? "High-value orders — typical for glass railing products." : "Consider upselling or bundling to increase order value."
      }`,
    });
  }

  // Trend analysis from history
  if (history.length >= 7) {
    const recentDays = history.slice(-7);
    const olderDays = history.slice(-14, -7);
    if (olderDays.length > 0) {
      const recentRevAvg = recentDays.reduce((s, d) => s + d.revenue, 0) / recentDays.length;
      const olderRevAvg = olderDays.reduce((s, d) => s + d.revenue, 0) / olderDays.length;
      if (olderRevAvg > 0) {
        const trendPct = Math.round(((recentRevAvg - olderRevAvg) / olderRevAvg) * 100);
        if (Math.abs(trendPct) >= 5) {
          insights.push({
            icon: trendPct > 0 ? "^" : "v",
            color: trendPct > 0 ? "text-green-700" : "text-red-600",
            text: `Revenue is trending ${trendPct > 0 ? "up" : "down"} ${Math.abs(trendPct)}% compared to the prior 7 days. ${
              trendPct > 0
                ? "Recent campaigns are performing well."
                : "Recent performance is declining — check if any campaigns were paused or budgets reduced."
            }`,
          });
        }
      }
    }
  }

  // Best / worst day
  if (history.length >= 3) {
    const daysWithRevenue = history.filter((d) => d.revenue > 0);
    if (daysWithRevenue.length > 0) {
      const best = daysWithRevenue.reduce((a, b) => (b.revenue > a.revenue ? b : a));
      const bestDate = new Date(best.date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      insights.push({
        icon: "*",
        color: "text-sand-700",
        text: `Best day was ${bestDate} with ${formatCurrency(best.revenue)} in revenue and a ${best.roas}x ROAS.`,
      });
    }
  }

  // Period comparison
  if (data.change.revenue !== null && data.change.revenue !== undefined) {
    const ch = data.change.revenue;
    if (Math.abs(ch) >= 5) {
      insights.push({
        icon: ch > 0 ? "^" : "v",
        color: ch > 0 ? "text-green-700" : "text-red-600",
        text: `Revenue is ${ch > 0 ? "up" : "down"} ${Math.abs(ch)}% compared to the previous ${days}-day period.`,
      });
    }
  }

  // Daily average
  if (days > 0 && c.ad_spend > 0) {
    insights.push({
      icon: "=",
      color: "text-sand-700",
      text: `Daily averages: ${formatCurrency(c.ad_spend / days)} ad spend, ${formatCurrency(c.revenue / days)} revenue, ${formatNumber(c.clicks / days)} clicks.`,
    });
  }

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5 h-fit">
      <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">
        Insights
      </p>
      {insights.length === 0 ? (
        <p className="text-sm text-sand-400">Not enough data to generate insights.</p>
      ) : (
        <div className="space-y-4">
          {insights.map((insight, i) => (
            <div key={i} className="flex gap-3">
              <span
                className={`shrink-0 w-6 h-6 rounded-full bg-sand-100 flex items-center justify-center text-xs font-bold ${insight.color}`}
              >
                {insight.icon}
              </span>
              <p className="text-sm text-sand-700 leading-relaxed">
                {insight.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MarketingDashboard() {
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState(() => daysAgoStr(30));
  const [customTo, setCustomTo] = useState(() => todayStr());
  const [data, setData] = useState<MarketingResponse | null>(null);
  const [history, setHistory] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [hasGA4, setHasGA4] = useState(false);
  const [market, setMarket] = useState<"all" | "us" | "ca">("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchTerms, setSearchTerms] = useState<SearchTermLite[]>([]);
  const forceNextRef = useRef(false);

  const getDateRange = useCallback(() => {
    const rangeDays: Record<string, number> = {
      "7d": 6, "30d": 29, "60d": 59, "100d": 99, "365d": 364, "2y": 729,
    };
    if (range in rangeDays) return { from: daysAgoStr(rangeDays[range]), to: todayStr() };
    return { from: customFrom, to: customTo };
  }, [range, customFrom, customTo]);

  const loadData = useCallback(async () => {
    const { from, to } = getDateRange();
    const force = forceNextRef.current;
    forceNextRef.current = false;

    // Check localStorage unless forcing a refresh
    if (!force) {
      const cacheKey = `overview:${from}:${to}:${market}:${demo}`;
      const cached = mktCacheLoad<{ data: MarketingResponse; history: DailyPoint[]; hasGA4: boolean; terms?: SearchTermLite[] }>(cacheKey);
      if (cached) {
        setData(cached.data);
        setHistory(cached.history ?? []);
        setHasGA4(cached.hasGA4 ?? false);
        setSearchTerms(cached.terms ?? []);
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ from, to });
      if (demo) params.set("demo", "true");
      if (market !== "all") params.set("market", market);
      if (force) params.set("fresh", "1");

      const histParams = new URLSearchParams({ view: "history", from, to });
      if (demo) histParams.set("demo", "true");
      if (market !== "all") histParams.set("market", market);
      if (force) histParams.set("fresh", "1");

      const termsParams = new URLSearchParams({ view: "search-terms", from, to });
      if (demo) termsParams.set("demo", "true");

      const [summaryRes, historyRes, termsRes] = await Promise.all([
        fetch(`/api/marketing?${params}`),
        fetch(`/api/marketing?${histParams}`),
        fetch(`/api/marketing?${termsParams}`).catch(() => null),
      ]);

      if (!summaryRes.ok) {
        const json = await summaryRes.json();
        throw new Error(json.error || "Failed to load");
      }

      const summaryData: MarketingResponse = await summaryRes.json();
      setData(summaryData);

      let histData: DailyPoint[] = [];
      let hasGA4Val = false;
      if (historyRes.ok) {
        const histJson = await historyRes.json();
        histData = histJson.history ?? [];
        hasGA4Val = !!histJson.hasGA4;
        setHistory(histData);
        setHasGA4(hasGA4Val);
      }

      // Search terms feed the wasted-spend insight; saving under the Search
      // Terms tab's cache key also makes that tab load instantly.
      let termsData: SearchTermLite[] = [];
      if (termsRes?.ok) {
        const termsJson = await termsRes.json();
        termsData = termsJson.searchTerms ?? [];
        mktCacheSave(`search:${from}:${to}:${demo}`, termsData);
      }
      setSearchTerms(termsData);

      mktCacheSave(`overview:${from}:${to}:${market}:${demo}`, { data: summaryData, history: histData, hasGA4: hasGA4Val, terms: termsData });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [getDateRange, demo, market]);

  const handleRefresh = useCallback(() => {
    // Clear all marketing cache entries so sub-tabs also fetch fresh
    mktCacheClearAll();
    forceNextRef.current = true;
    setRefreshKey((k) => k + 1);
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute derived chart data. Today is excluded from charts — it's a partial
  // day and always looks like a crash next to complete days.
  const dailyHistory: DerivedPoint[] = useMemo(() => {
    const complete = history.filter((d) => d.date !== todayStr());
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

  // Long ranges aggregate to complete calendar weeks (Mon–Sun) — hundreds of
  // daily points are unreadable noise for a low-volume, high-value store.
  const isWeekly = dailyHistory.length > 70;
  const chartData: DerivedPoint[] = useMemo(() => {
    if (!isWeekly) return dailyHistory;
    const byWeek = new Map<string, DerivedPoint[]>();
    for (const d of dailyHistory) {
      const w = weekStartStr(d.date);
      const arr = byWeek.get(w) ?? [];
      arr.push(d);
      byWeek.set(w, arr);
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return [...byWeek.entries()]
      .filter(([, days]) => days.length === 7) // partial edge weeks would plot as fake dips
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, days]) => {
        const sum = (f: (d: DerivedPoint) => number) => days.reduce((s, d) => s + f(d), 0);
        const ad_spend = r2(sum((d) => d.ad_spend));
        const revenue = r2(sum((d) => d.revenue));
        const ads_revenue = r2(sum((d) => d.ads_revenue ?? 0));
        const clicks = sum((d) => d.clicks);
        const impressions = sum((d) => d.impressions);
        const conversions = r2(sum((d) => d.conversions));
        const order_count = sum((d) => d.order_count);
        const hasSessions = days.some((d) => d.sessions !== undefined);
        return {
          date,
          ad_spend,
          revenue,
          ads_revenue,
          clicks,
          impressions,
          conversions,
          order_count,
          ...(hasSessions ? { sessions: sum((d) => d.sessions ?? 0) } : {}),
          roas: ad_spend > 0 ? r2(revenue / ad_spend) : 0,
          google_roas: ad_spend > 0 ? r2(ads_revenue / ad_spend) : 0,
          cpc: clicks > 0 ? r2(ad_spend / clicks) : 0,
          ctr: impressions > 0 ? r2((clicks / impressions) * 100) : 0,
          profit: r2(revenue - ad_spend),
          aov: order_count > 0 ? r2(revenue / order_count) : 0,
          revenue_ma7: 0,
        };
      });
  }, [dailyHistory, isWeekly]);

  const chartsExcludeToday = useMemo(
    () => history.some((d) => d.date === todayStr()),
    [history]
  );

  const chartLabel = (l: unknown) => (isWeekly ? `Week of ${formatShortDate(l)}` : formatShortDate(l));
  const perUnit = isWeekly ? "/wk" : "";

  // Period averages for reference lines
  const avgs = useMemo(() => {
    const n = chartData.length || 1;
    const sum = (fn: (d: DerivedPoint) => number) =>
      Math.round((chartData.reduce((s, d) => s + fn(d), 0) / n) * 100) / 100;
    const totalSpend = chartData.reduce((s, d) => s + d.ad_spend, 0);
    const totalClicks = chartData.reduce((s, d) => s + d.clicks, 0);
    const totalImpressions = chartData.reduce((s, d) => s + d.impressions, 0);
    const totalRevenue = chartData.reduce((s, d) => s + d.revenue, 0);
    const totalAdsRevenue = chartData.reduce((s, d) => s + (d.ads_revenue ?? 0), 0);
    const totalOrders = chartData.reduce((s, d) => s + d.order_count, 0);
    return {
      revenue: sum((d) => d.revenue),
      ad_spend: sum((d) => d.ad_spend),
      roas: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0,
      google_roas: totalSpend > 0 ? Math.round((totalAdsRevenue / totalSpend) * 100) / 100 : 0,
      conversions: sum((d) => d.conversions),
      clicks: sum((d) => d.clicks),
      cpc: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0,
      ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0,
      profit: sum((d) => d.profit),
      aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      order_count: sum((d) => d.order_count),
    };
  }, [chartData]);

  const { from, to } = getDateRange();
  const days = Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86400000
  );
  const rangeLabel = range === "custom" ? `${days}d` : range;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "campaigns", label: "Campaigns" },
    { key: "audience", label: "Audience" },
    { key: "search", label: "Search Terms" },
    { key: "analysis", label: "Analysis" },
  ];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap rounded-lg border border-sand-200 overflow-hidden">
          {([
            ["7d", "7D"],
            ["30d", "30D"],
            ["60d", "60D"],
            ["100d", "100D"],
            ["365d", "1Y"],
            ["2y", "2Y"],
            ["custom", "Custom"],
          ] as [Range, string][]).map(([r, label]) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                range === r
                  ? "bg-sand-900 text-sand-50"
                  : "bg-white text-sand-600 hover:bg-sand-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 bg-white"
            />
            <span className="text-sand-400 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 bg-white"
            />
          </div>
        )}

        <div className="flex rounded-lg border border-sand-200 overflow-hidden">
          {([
            ["all", "All"],
            ["us", "US"],
            ["ca", "CA"],
          ] as ["all" | "us" | "ca", string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                market === m
                  ? "bg-sand-900 text-sand-50"
                  : "bg-white text-sand-600 hover:bg-sand-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setDemo(!demo)}
          className={`ml-auto px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
            demo
              ? "bg-amber-50 border-amber-300 text-amber-700"
              : "bg-white border-sand-200 text-sand-500 hover:bg-sand-50"
          }`}
        >
          {demo ? "Demo ON" : "Demo"}
        </button>

        <button
          onClick={handleRefresh}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-sand-200 overflow-hidden w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-sand-900 text-sand-50"
                : "bg-white text-sand-600 hover:bg-sand-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {data?.demo && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Showing demo data. Toggle off to view live Google Ads data.
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data?.dateRange && tab === "overview" && (
        <p className="text-xs text-sand-400">
          Showing: {data.dateRange.current.from} &rarr; {data.dateRange.current.to}
          {" · "}
          Compared to previous {rangeLabel}: {data.dateRange.previous.from} &rarr; {data.dateRange.previous.to}
          {isWeekly
            ? " · charts show weekly totals (partial weeks excluded)"
            : chartsExcludeToday
              ? " · charts exclude today (partial day)"
              : ""}
        </p>
      )}

      {/* Tab content */}
      {tab === "overview" && (
        <>
          {/* Metric cards — row 1: core metrics */}
          {data && !loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {METRICS.map((m) => (
                <div
                  key={m.key}
                  className="bg-white rounded-xl border border-sand-200/60 p-5"
                >
                  <div className="flex items-center">
                    <p className="text-xs text-sand-400 uppercase tracking-wider">
                      {m.label}
                    </p>
                    {METRIC_INFO[m.key] && <InfoTooltip text={METRIC_INFO[m.key]} />}
                  </div>
                  <p className="text-2xl font-semibold text-sand-900 mt-2">
                    {m.format(data.current[m.key] ?? 0)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-sand-400">
                      was {m.format(data.previous[m.key] ?? 0)}
                    </span>
                    <ChangeBadge value={data.change[m.key] ?? null} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Metric cards — row 2: derived metrics */}
          {data && !loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {DERIVED_METRICS.map((m) => {
                const curVal = m.compute(data.current);
                const prevVal = m.compute(data.previous);
                const change = m.change(data.current, data.previous);
                return (
                  <div
                    key={m.key}
                    className="bg-white rounded-xl border border-sand-200/60 p-5"
                  >
                    <div className="flex items-center">
                      <p className="text-xs text-sand-400 uppercase tracking-wider">
                        {m.label}
                      </p>
                      {METRIC_INFO[m.key] && <InfoTooltip text={METRIC_INFO[m.key]} />}
                    </div>
                    <p className="text-2xl font-semibold text-sand-900 mt-2">
                      {m.format(curVal)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-sand-400">
                        was {m.format(prevVal)}
                      </span>
                      <ChangeBadge value={change} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Charts + Insights */}
          {dailyHistory.length > 0 && !loading && data && (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Revenue & Ad Spend — aligned panels, each on its own scale.
                    Spend is ~1/10th of revenue, so a shared axis flattens it
                    into an unreadable line. */}
                <RevenueSpendCard
                  data={chartData}
                  avgRev={avgs.revenue}
                  avgSpend={avgs.ad_spend}
                  rangeLabel={rangeLabel}
                  weekly={isWeekly}
                />

                {/* Ad Spend */}
                <ChartCard title={`Ad Spend (${rangeLabel})`} chartKey="Ad Spend" avg={formatCurrency(avgs.ad_spend) + perUnit}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradAdSpend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#dc2626" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatCurrency(Number(value)), "Ad Spend"]} />
                      <ReferenceLine y={avgs.ad_spend} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="ad_spend" stroke="#dc2626" strokeWidth={2} fill="url(#gradAdSpend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* ROAS — blended vs Google-attributed */}
                <ChartCard
                  title={`ROAS (${rangeLabel})`}
                  chartKey="ROAS"
                  avg={`${avgs.roas}x blended / ${avgs.google_roas}x Google`}
                  legend={
                    <>
                      <LegendDot color="#b45309" label="Blended (all revenue)" line />
                      <LegendDot color="#0f766e" label="Google-attributed" line />
                    </>
                  }
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}x`} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown, name: unknown) => [`${value}x`, name === "roas" ? "Blended" : "Google-attributed"]} />
                      <ReferenceLine y={avgs.roas} stroke="#b45309" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Line type="monotone" dataKey="roas" stroke="#b45309" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#b45309" }} />
                      <Line type="monotone" dataKey="google_roas" stroke="#0f766e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#0f766e" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Conversions */}
                <ChartCard title={`Conversions (${rangeLabel})`} chartKey="Conversions" avg={formatNumber(avgs.conversions) + perUnit}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatNumber(Number(value)), "Conversions"]} />
                      <ReferenceLine y={avgs.conversions} stroke="#7c3aed" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="conversions" stroke="#7c3aed" strokeWidth={2} fill="url(#gradConv)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Clicks */}
                <ChartCard title={`Clicks (${rangeLabel})`} chartKey="Clicks" avg={formatNumber(avgs.clicks) + perUnit}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradClicks" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563eb" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatNumber(Number(value)), "Clicks"]} />
                      <ReferenceLine y={avgs.clicks} stroke="#2563eb" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="clicks" stroke="#2563eb" strokeWidth={2} fill="url(#gradClicks)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* CPC Over Time */}
                <ChartCard title={`CPC (${rangeLabel})`} chartKey="CPC" avg={formatCurrency2(avgs.cpc)}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatCurrency2(Number(value)), "CPC"]} />
                      <ReferenceLine y={avgs.cpc} stroke="#0891b2" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Line type="monotone" dataKey="cpc" stroke="#0891b2" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#0891b2" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* CTR Over Time */}
                <ChartCard title={`CTR (${rangeLabel})`} chartKey="CTR" avg={formatPct(avgs.ctr)}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatPct(Number(value)), "CTR"]} />
                      <ReferenceLine y={avgs.ctr} stroke="#ea580c" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Line type="monotone" dataKey="ctr" stroke="#ea580c" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#ea580c" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Profit Over Time */}
                <ChartCard title={`Profit (${rangeLabel})`} chartKey="Profit" avg={formatCurrency(avgs.profit) + perUnit}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#16a34a" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatCurrency(Number(value)), "Profit"]} />
                      <ReferenceLine y={0} stroke="#a39e93" strokeDasharray="3 3" />
                      <ReferenceLine y={avgs.profit} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="profit" stroke="#16a34a" strokeWidth={2} fill="url(#gradProfit)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* AOV Over Time */}
                <ChartCard title={`Avg Order Value (${rangeLabel})`} chartKey="AOV" avg={formatCurrency2(avgs.aov)}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatCurrency2(Number(value)), "AOV"]} />
                      <ReferenceLine y={avgs.aov} stroke="#9333ea" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Line type="monotone" dataKey="aov" stroke="#9333ea" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#9333ea" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Order Count Per Day */}
                <ChartCard title={`Orders Per  ()`} chartKey="Order Count" avg={formatNumber(avgs.order_count) + perUnit}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#d946ef" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="#d946ef" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                      <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} labelFormatter={chartLabel} formatter={(value: unknown) => [formatNumber(Number(value)), "Orders"]} />
                      <ReferenceLine y={avgs.order_count} stroke="#d946ef" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="order_count" stroke="#d946ef" strokeWidth={2} fill="url(#gradOrders)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Impressions vs Website Visits (only if GA4 data available) */}
                {hasGA4 && chartData.some((d) => d.sessions !== undefined) && (
                  <ChartCard title={`Impressions vs Visits (${rangeLabel})`} chartKey="Impressions vs Visits">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          {...tooltipStyle}
                          labelFormatter={chartLabel}
                          formatter={(value: unknown, name: unknown) => [
                            formatNumber(Number(value)),
                            name === "impressions" ? "Impressions" : "Website Visits",
                          ]}
                        />
                        <Line yAxisId="left" type="monotone" dataKey="impressions" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#2563eb" }} />
                        <Line yAxisId="right" type="monotone" dataKey="sessions" stroke="#16a34a" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#16a34a" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}

                {/* GA4 not configured notice */}
                {!hasGA4 && !demo && (
                  <div className="bg-white rounded-xl border border-sand-200/60 p-5 flex items-center justify-center">
                    <p className="text-sm text-sand-400 text-center">
                      Connect Google Analytics 4 to see website visits alongside ad impressions.
                      <br />
                      <span className="text-xs">Set <code className="bg-sand-100 px-1 rounded">GOOGLE_GA4_PROPERTY_ID</code> in your environment.</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Insights Panel */}
              <InsightsPanel data={data} history={history} days={days} terms={searchTerms} />
            </div>
          )}

          {loading && !data && (
            <div className="text-center py-12 text-sand-400">
              Loading marketing data...
            </div>
          )}
        </>
      )}

      {tab === "campaigns" && <CampaignsTab from={from} to={to} demo={demo} market={market} refreshKey={refreshKey} />}
      {tab === "audience" && <AudienceTab from={from} to={to} demo={demo} market={market} refreshKey={refreshKey} />}
      {tab === "search" && <SearchTermsTab from={from} to={to} demo={demo} refreshKey={refreshKey} />}
      {tab === "analysis" && <AnalysisTab />}
    </div>
  );
}
