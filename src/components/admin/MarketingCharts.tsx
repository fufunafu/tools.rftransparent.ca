"use client";

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
import { formatCAD, formatCADWhole } from "@/lib/format";

// Extracted from MarketingDashboard and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as ShopifyCharts).

export interface DerivedPoint {
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
  cpc: number;
  ctr: number;
  profit: number;
  aov: number;
  revenue_ma7: number;
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

function formatShortDate(label: unknown) {
  const dateStr = String(label);
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function makeLabel(weekly?: boolean) {
  return (l: unknown) => (weekly ? `Week of ${formatShortDate(l)}` : formatShortDate(l));
}

const tooltipStyle = {
  contentStyle: {
    background: "#faf9f7",
    border: "1px solid #e5e0d8",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

// The two aligned Revenue / Ad Spend panels. Rendered small inside the card
// and large inside the expand modal, so heights are parameterized.
export function RevenueSpendPanels({ data, big, weekly }: { data: DerivedPoint[]; big?: boolean; weekly?: boolean }) {
  const label = makeLabel(weekly);
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
            <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown, name: unknown) => [formatCADWhole(Number(value)), name === "revenue" ? "Revenue" : "7-day avg"]} />
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
            <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatCADWhole(Number(value)), "Ad Spend"]} />
            <Area type="monotone" dataKey="ad_spend" stroke="#dc2626" strokeWidth={2} fill="url(#gradSpendPanel)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function AdSpendChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradAdSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dc2626" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatCADWhole(Number(value)), "Ad Spend"]} />
        <ReferenceLine y={avg} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="ad_spend" stroke="#dc2626" strokeWidth={2} fill="url(#gradAdSpend)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RoasChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}x`} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown, name: unknown) => [`${value}x`, name === "roas" ? "Blended" : "Google-attributed"]} />
        <ReferenceLine y={avg} stroke="#b45309" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Line type="monotone" dataKey="roas" stroke="#b45309" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#b45309" }} />
        <Line type="monotone" dataKey="google_roas" stroke="#0f766e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#0f766e" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ConversionsChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatNumber(Number(value)), "Conversions"]} />
        <ReferenceLine y={avg} stroke="#7c3aed" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="conversions" stroke="#7c3aed" strokeWidth={2} fill="url(#gradConv)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ClicksChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradClicks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatNumber(Number(value)), "Clicks"]} />
        <ReferenceLine y={avg} stroke="#2563eb" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="clicks" stroke="#2563eb" strokeWidth={2} fill="url(#gradClicks)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CpcChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatCAD(Number(value)), "CPC"]} />
        <ReferenceLine y={avg} stroke="#0891b2" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Line type="monotone" dataKey="cpc" stroke="#0891b2" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#0891b2" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CtrChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatPct(Number(value)), "CTR"]} />
        <ReferenceLine y={avg} stroke="#ea580c" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Line type="monotone" dataKey="ctr" stroke="#ea580c" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#ea580c" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ProfitChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={formatAxisCurrency} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatCADWhole(Number(value)), "Profit"]} />
        <ReferenceLine y={0} stroke="#a39e93" strokeDasharray="3 3" />
        <ReferenceLine y={avg} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="profit" stroke="#16a34a" strokeWidth={2} fill="url(#gradProfit)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AovChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatCAD(Number(value)), "AOV"]} />
        <ReferenceLine y={avg} stroke="#9333ea" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Line type="monotone" dataKey="aov" stroke="#9333ea" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#9333ea" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function OrdersChart({ data, weekly, avg }: { data: DerivedPoint[]; weekly?: boolean; avg: number }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d946ef" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#d946ef" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} labelFormatter={label} formatter={(value: unknown) => [formatNumber(Number(value)), "Orders"]} />
        <ReferenceLine y={avg} stroke="#d946ef" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="order_count" stroke="#d946ef" strokeWidth={2} fill="url(#gradOrders)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ImpressionsVisitsChart({ data, weekly }: { data: DerivedPoint[]; weekly?: boolean }) {
  const label = makeLabel(weekly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#a39e93" }} axisLine={false} tickLine={false} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={label}
          formatter={(value: unknown, name: unknown) => [
            formatNumber(Number(value)),
            name === "impressions" ? "Impressions" : "Website Visits",
          ]}
        />
        <Line yAxisId="left" type="monotone" dataKey="impressions" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#2563eb" }} />
        <Line yAxisId="right" type="monotone" dataKey="sessions" stroke="#16a34a" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#16a34a" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
