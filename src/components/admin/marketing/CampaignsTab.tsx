"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface CampaignData {
  campaign: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

type SortKey = "campaign" | "ad_spend" | "revenue" | "roas" | "clicks" | "impressions" | "conversions";

export default function CampaignsTab({
  from,
  to,
  demo,
  market = "all",
}: {
  from: string;
  to: string;
  demo: boolean;
  market?: string;
}) {
  const [data, setData] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ad_spend");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ view: "campaigns", from, to });
    if (demo) params.set("demo", "true");
    if (market !== "all") params.set("market", market);
    fetch(`/api/marketing?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json.campaigns ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [from, to, demo, market]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string")
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const SortHeader = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-sand-500 uppercase tracking-wider cursor-pointer hover:text-sand-700 select-none"
      onClick={() => handleSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );

  if (loading) return <div className="text-center py-12 text-sand-400">Loading campaign data...</div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (data.length === 0) return <div className="text-center py-12 text-sand-400">No campaign data available.</div>;

  const tooltipStyle = {
    contentStyle: { background: "#faf9f7", border: "1px solid #e5e0d8", borderRadius: "8px", fontSize: "12px" },
  };

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-5">
        <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">Revenue vs Ad Spend by Campaign</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v) => `$${v}`} />
              <YAxis
                type="category"
                dataKey="campaign"
                tick={{ fontSize: 11, fill: "#a39e93" }}
                width={180}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: unknown, name: unknown) => [
                  formatCurrency(Number(value)),
                  name === "revenue" ? "Revenue" : "Ad Spend",
                ]}
              />
              <Bar dataKey="revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
              <Bar dataKey="ad_spend" fill="#dc2626" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-sand-50 border-b border-sand-200/60">
              <tr>
                <SortHeader k="campaign" label="Campaign" />
                <SortHeader k="ad_spend" label="Spend" />
                <SortHeader k="revenue" label="Revenue" />
                <SortHeader k="roas" label="ROAS" />
                <SortHeader k="clicks" label="Clicks" />
                <SortHeader k="impressions" label="Impressions" />
                <SortHeader k="conversions" label="Conv." />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {sorted.map((c) => {
                const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : "0";
                const cpc = c.clicks > 0 ? (c.ad_spend / c.clicks).toFixed(2) : "0";
                return (
                  <tr key={c.campaign} className="hover:bg-sand-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-sand-900">{c.campaign}</td>
                    <td className="px-4 py-3 text-sm text-sand-700">{formatCurrency(c.ad_spend)}</td>
                    <td className="px-4 py-3 text-sm text-sand-700">{formatCurrency(c.revenue)}</td>
                    <td className="px-4 py-3 text-sm text-sand-700">{c.roas}x</td>
                    <td className="px-4 py-3 text-sm text-sand-700">
                      {formatNumber(c.clicks)}
                      <span className="text-sand-400 text-xs ml-1">({ctr}% CTR)</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-sand-700">{formatNumber(c.impressions)}</td>
                    <td className="px-4 py-3 text-sm text-sand-700">
                      {formatNumber(c.conversions)}
                      <span className="text-sand-400 text-xs ml-1">(${cpc}/click)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
