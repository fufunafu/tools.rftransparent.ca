"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { mktCacheSave, mktCacheLoad } from "@/lib/marketing-cache";
import { formatCAD } from "@/lib/format";

interface SearchTermData {
  term: string;
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

type SortKey = "term" | "ad_spend" | "clicks" | "impressions" | "conversions" | "revenue" | "roas";

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={ref}
      className="relative inline-flex ml-1 cursor-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <svg className="w-3.5 h-3.5 text-sand-400 hover:text-sand-600 transition-colors" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 110 2 1 1 0 010-2zM6.5 7h2v4.5h-2V7h1z" />
      </svg>
      {open && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 text-xs text-sand-700 bg-white border border-sand-200 rounded-lg shadow-lg leading-relaxed font-normal normal-case tracking-normal pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-sand-200" />
        </span>
      )}
    </span>
  );
}

const COLUMN_TOOLTIPS: Partial<Record<SortKey, string>> = {
  ad_spend: "Total amount spent on this search term in Google Ads for the selected period.",
  conversions: "Number of completed purchases attributed to this search term by Google Ads conversion tracking.",
  revenue: "Revenue attributed by Google Ads (conversions_value), based on your conversion tag fired at Shopify checkout.",
  roas: "Return on Ad Spend = Revenue / Spend. A ROAS of 3x means $3 earned for every $1 spent.",
};

function SearchTermSortHeader({
  column,
  label,
  align,
  activeColumn,
  ascending,
  onSort,
}: {
  column: SortKey;
  label: string;
  align?: "left" | "right";
  activeColumn: SortKey;
  ascending: boolean;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium text-sand-500 uppercase tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        className="inline-flex items-center select-none hover:text-sand-700"
        onClick={() => onSort(column)}
      >
        {label}
        {COLUMN_TOOLTIPS[column] && <InfoTooltip text={COLUMN_TOOLTIPS[column]} />}
        {activeColumn === column ? (ascending ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export default function SearchTermsTab({
  from,
  to,
  demo,
  refreshKey = 0,
}: {
  from: string;
  to: string;
  demo: boolean;
  refreshKey?: number;
}) {
  const [data, setData] = useState<SearchTermData[]>([]);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("clicks");
  const [sortAsc, setSortAsc] = useState(false);

  const cacheKey = `search:${from}:${to}:${demo}`;
  const queryKey = `${cacheKey}:${refreshKey}`;
  const loading = resolvedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await Promise.resolve();
      setError("");
      const cached = mktCacheLoad<SearchTermData[]>(cacheKey);
      if (cached) {
        if (!cancelled) {
          setData(cached);
          setResolvedKey(queryKey);
        }
        return;
      }

      const params = new URLSearchParams({ view: "search-terms", from, to });
      if (demo) params.set("demo", "true");
      try {
        const response = await fetch(`/api/marketing?${params}`);
        const json = await response.json();
        if (json.error) throw new Error(json.error);
        const terms = json.searchTerms ?? [];
        if (!cancelled) {
          setData(terms);
          mktCacheSave(cacheKey, terms);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load search terms");
      } finally {
        if (!cancelled) setResolvedKey(queryKey);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [cacheKey, queryKey, from, to, demo]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const items = q ? data.filter((d) => d.term.toLowerCase().includes(q)) : data;
    return [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string")
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, search, sortKey, sortAsc]);

  if (loading) return <div className="text-center py-12 text-sand-400">Loading search terms...</div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          aria-label="Filter search terms"
          placeholder="Filter search terms..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 bg-white w-64"
        />
        <span className="text-xs text-sand-400">{filtered.length} terms</span>
      </div>

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-sand-50 border-b border-sand-200/60">
              <tr>
                <SearchTermSortHeader column="term" label="Search Term" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <SearchTermSortHeader column="clicks" label="Clicks" align="right" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <SearchTermSortHeader column="impressions" label="Impressions" align="right" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <SearchTermSortHeader column="ad_spend" label="Spend" align="right" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <SearchTermSortHeader column="conversions" label="Conv." align="right" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <SearchTermSortHeader column="revenue" label="Revenue" align="right" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
                <SearchTermSortHeader column="roas" label="ROAS" align="right" activeColumn={sortKey} ascending={sortAsc} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-sand-400">
                    {data.length === 0 ? "No search term data available." : "No matching terms."}
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const ctr = t.impressions > 0 ? ((t.clicks / t.impressions) * 100).toFixed(2) : "0";
                  const cpc = t.clicks > 0 ? (t.ad_spend / t.clicks).toFixed(2) : "0";
                  // Highlight: high spend + low conversions = wasteful
                  const isWasteful = t.ad_spend > 50 && t.conversions === 0;
                  const isValuable = t.conversions > 0 && t.roas >= 3;
                  return (
                    <tr
                      key={t.term}
                      className={`transition-colors ${
                        isWasteful
                          ? "bg-red-50/50 hover:bg-red-50"
                          : isValuable
                            ? "bg-green-50/30 hover:bg-green-50/50"
                            : "hover:bg-sand-50/50"
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-sand-900">
                        {t.term}
                        {isWasteful && (
                          <span className="ml-2 text-[10px] font-medium text-red-500 bg-red-100 px-1.5 py-0.5 rounded inline-flex items-center">
                            wasteful
                            <InfoTooltip text="This term spent over $50 with zero conversions. It's consuming budget without generating sales. Consider adding it as a negative keyword." />
                          </span>
                        )}
                        {isValuable && (
                          <span className="ml-2 text-[10px] font-medium text-green-600 bg-green-100 px-1.5 py-0.5 rounded inline-flex items-center">
                            valuable
                            <InfoTooltip text="This term has conversions with a ROAS of 3x or higher, meaning it earns at least $3 for every $1 spent. Consider increasing bids to capture more traffic." />
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-sand-700 text-right">
                        {formatNumber(t.clicks)}
                        <span className="text-sand-400 text-xs ml-1">({ctr}%)</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-sand-700 text-right">{formatNumber(t.impressions)}</td>
                      <td className="px-4 py-3 text-sm text-sand-700 text-right">
                        {formatCAD(t.ad_spend)}
                        <span className="text-sand-400 text-xs ml-1">(${cpc})</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-sand-700 text-right">{formatNumber(t.conversions)}</td>
                      <td className="px-4 py-3 text-sm text-sand-700 text-right">{formatCAD(t.revenue)}</td>
                      <td className="px-4 py-3 text-sm text-sand-700 text-right">{t.roas}x</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
