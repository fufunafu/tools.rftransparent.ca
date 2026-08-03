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
import { mktCacheSave, mktCacheLoad } from "@/lib/marketing-cache";
import { formatCADWhole } from "@/lib/format";

interface CampaignData {
  campaign: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

type SortKey = "campaign" | "ad_spend" | "revenue" | "roas" | "clicks" | "impressions" | "conversions";

function CampaignSortHeader({
  column,
  label,
  activeColumn,
  ascending,
  onSort,
}: {
  column: SortKey;
  label: string;
  activeColumn: SortKey;
  ascending: boolean;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-sand-500 uppercase tracking-wider">
      <button
        type="button"
        className="select-none hover:text-sand-700"
        onClick={() => onSort(column)}
      >
        {label} {activeColumn === column ? (ascending ? "↑" : "↓") : ""}
      </button>
    </th>
  );
}

export default function CampaignsTab({
  from,
  to,
  demo,
  market = "all",
  refreshKey = 0,
}: {
  from: string;
  to: string;
  demo: boolean;
  market?: string;
  refreshKey?: number;
}) {
  const [data, setData] = useState<CampaignData[]>([]);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ad_spend");
  const [sortAsc, setSortAsc] = useState(false);

  const cacheKey = `campaigns:${from}:${to}:${market}:${demo}`;
  const queryKey = `${cacheKey}:${refreshKey}`;
  const loading = resolvedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await Promise.resolve();
      setError("");
      const cached = mktCacheLoad<CampaignData[]>(cacheKey);
      if (cached) {
        if (!cancelled) {
          setData(cached);
          setResolvedKey(queryKey);
        }
        return;
      }

      const params = new URLSearchParams({ view: "campaigns", from, to });
      if (demo) params.set("demo", "true");
      if (market !== "all") params.set("market", market);
      try {
        const response = await fetch(`/api/marketing?${params}`);
        const json = await response.json();
        if (json.error) throw new Error(json.error);
        const campaigns = json.campaigns ?? [];
        if (!cancelled) {
          setData(campaigns);
          mktCacheSave(cacheKey, campaigns);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load campaigns");
      } finally {
        if (!cancelled) setResolvedKey(queryKey);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [cacheKey, queryKey, from, to, demo, market]);

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

  if (loading) return <div className="text-center py-12 text-sand-400">Loading campaign data...</div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (data.length === 0) return <div className="text-center py-12 text-sand-400">No campaign data available.</div>;

  const tooltipStyle = {
    contentStyle: { background: "#faf9f7", border: "1px solid #e5e0d8", borderRadius: "8px", fontSize: "12px" },
  };

  const topCampaigns = [...data].sort((a, b) => b.ad_spend - a.ad_spend).slice(0, 10);

  const totals = data.reduce(
    (t, c) => ({
      ad_spend: t.ad_spend + c.ad_spend,
      revenue: t.revenue + c.revenue,
      clicks: t.clicks + c.clicks,
      impressions: t.impressions + c.impressions,
      conversions: t.conversions + c.conversions,
    }),
    { ad_spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0 }
  );
  const totalRoas = totals.ad_spend > 0 ? (totals.revenue / totals.ad_spend).toFixed(2) : "0";
  const totalCtr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : "0";
  const totalCpc = totals.clicks > 0 ? (totals.ad_spend / totals.clicks).toFixed(2) : "0";

  return (
    <div className="space-y-6">
      {/* Bar chart — top campaigns only; 50 rows in one chart is unreadable */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-sand-400 uppercase tracking-wider">
            Revenue vs Ad Spend by Campaign
            {data.length > topCampaigns.length && (
              <span className="normal-case tracking-normal"> · top {topCampaigns.length} of {data.length} by spend</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 mb-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-sand-500">
            <span className="w-2 h-2 rounded-full" style={{ background: "#16a34a" }} /> Revenue
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-sand-500">
            <span className="w-2 h-2 rounded-full" style={{ background: "#dc2626" }} /> Ad Spend
          </span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topCampaigns} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} />
              <YAxis
                type="category"
                dataKey="campaign"
                tick={{ fontSize: 11, fill: "#a39e93" }}
                width={180}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: unknown, name: unknown) => [
                  formatCADWhole(Number(value)),
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
                <CampaignSortHeader column="campaign" label="Campaign" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <CampaignSortHeader column="ad_spend" label="Spend" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <CampaignSortHeader column="revenue" label="Revenue" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <CampaignSortHeader column="roas" label="ROAS" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <CampaignSortHeader column="clicks" label="Clicks" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <CampaignSortHeader column="impressions" label="Impressions" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <CampaignSortHeader column="conversions" label="Conv." activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {sorted.map((c) => {
                const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : "0";
                const cpc = c.clicks > 0 ? (c.ad_spend / c.clicks).toFixed(2) : "0";
                return (
                  <tr key={c.campaign} className="hover:bg-sand-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-sand-900">{c.campaign}</td>
                    <td className="px-4 py-3 text-sm text-sand-700">{formatCADWhole(c.ad_spend)}</td>
                    <td className="px-4 py-3 text-sm text-sand-700">{formatCADWhole(c.revenue)}</td>
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
            <tfoot className="bg-sand-50 border-t border-sand-200/60">
              <tr>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">Total ({data.length} campaigns)</td>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">{formatCADWhole(totals.ad_spend)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">{formatCADWhole(totals.revenue)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">{totalRoas}x</td>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">
                  {formatNumber(totals.clicks)}
                  <span className="text-sand-400 text-xs ml-1 font-normal">({totalCtr}% CTR)</span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">{formatNumber(totals.impressions)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-sand-900">
                  {formatNumber(totals.conversions)}
                  <span className="text-sand-400 text-xs ml-1 font-normal">(${totalCpc}/click)</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
