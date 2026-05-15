"use client";

import { useMemo, useState } from "react";
import type { Category, ProductWithMetrics } from "@/lib/purchasing/types";
import ColumnHint from "./ColumnHint";

interface Props { initialProducts: ProductWithMetrics[] }

type SortKey =
  | "sort_order" | "sku" | "overstock"
  | "current_inventory" | "storage_capacity" | "days_until_capacity";

function fmtNum(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-CA", { maximumFractionDigits: digits });
}
function daysUntilCapacity(p: ProductWithMetrics): number | null {
  if (p.overstock <= 0) return 0;
  if (p.daily_sales <= 0) return null;
  return p.overstock / p.daily_sales;
}

export default function OverstockTable({ initialProducts }: Props) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("overstock");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const enriched = useMemo(
    () => initialProducts.map((p) => ({
      ...p,
      days_until_capacity: daysUntilCapacity(p),
    })),
    [initialProducts],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = enriched.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!showAll && p.overstock <= 0) return false;
      if (q && !p.sku.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey as keyof typeof a];
      const bv = b[sortKey as keyof typeof b];
      const aNum = av === null ? -Infinity : Number(av);
      const bNum = bv === null ? -Infinity : Number(bv);
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });
    return rows;
  }, [enriched, category, search, showAll, sortKey, sortDir]);

  const totals = useMemo(() => {
    let units = 0;
    for (const p of visible) {
      if (p.overstock > 0) units += p.overstock;
    }
    return { units };
  }, [visible]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "sku" ? "asc" : "desc"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
          {(["all", "glass", "hardware"] as const).map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={"px-3 py-1.5 text-sm capitalize " + (category === c ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>{c}</button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-sand-700 px-2">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all products (not just overstocked)
        </label>
        <input type="text" placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 flex-1 min-w-[200px]" />
        <div className="text-xs text-sand-500 ml-auto">{visible.length} of {enriched.length} products</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Overstocked SKUs</div>
          <div className="text-2xl font-semibold text-sand-900 mt-1 tabular-nums">{enriched.filter((p) => p.overstock > 0).length}</div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Excess units (visible)</div>
          <div className="text-2xl font-semibold text-sand-900 mt-1 tabular-nums">{fmtNum(totals.units, 0)}</div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 z-20 bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
            <tr>
              <Th sortKey="sku" current={sortKey} dir={sortDir} onToggle={toggleSort}>SKU</Th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <Th sortKey="current_inventory" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">On hand<ColumnHint>Units currently in the warehouse — what you have right now, not counting what&apos;s on its way.</ColumnHint></span>
              </Th>
              <Th sortKey="storage_capacity" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Capacity<ColumnHint>The most units you ever want to keep on hand for this SKU. Anything above this is &ldquo;overstock&rdquo;.</ColumnHint></span>
              </Th>
              <Th sortKey="overstock" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Overstock<ColumnHint>How many units you&apos;re over capacity by: <span className="font-mono">on_hand − capacity</span>. Positive (red) means you have more than you want.</ColumnHint></span>
              </Th>
              <th className="text-right px-3 py-2 font-medium">
                <span className="inline-flex items-center justify-end w-full">Monthly<ColumnHint>Average units sold per month = GRS + RF channels. From the trailing-12-month rolling average.</ColumnHint></span>
              </th>
              <Th sortKey="days_until_capacity" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Days to clear<ColumnHint>How long the excess takes to burn off at the current sales rate: <span className="font-mono">overstock / (monthly / 30)</span>. &ldquo;No sales&rdquo; means it&apos;ll never clear on its own.</ColumnHint></span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visible.map((p) => {
              const isOver = p.overstock > 0;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2 text-sand-700">{p.name}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(p.current_inventory, 0)}</td>
                  <td className="px-3 py-2 text-right text-sand-500">{fmtNum(p.storage_capacity, 0)}</td>
                  <td className={"px-3 py-2 text-right " + (isOver ? "text-red-700 font-medium" : "text-sand-500")}>
                    {p.overstock > 0 ? "+" : ""}{fmtNum(p.overstock, 0)}
                  </td>
                  <td className="px-3 py-2 text-right text-sand-500">{fmtNum(p.avg_monthly_sales_grs + p.avg_monthly_sales_rf, 1)}</td>
                  <td className="px-3 py-2 text-right">
                    {!isOver ? "—" : p.days_until_capacity === null ? "no sales" : fmtNum(p.days_until_capacity, 0)}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sand-500">
                {showAll ? "No products match these filters." : "Nothing is overstocked right now."}
              </td></tr>
            )}
          </tbody>
          {visible.length > 0 && (
            <tfoot className="bg-sand-50 text-sand-700 font-medium">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right">Total ({visible.filter((p) => p.overstock > 0).length} over)</td>
                <td className="px-3 py-2 text-right">+{fmtNum(totals.units, 0)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-sand-500">
        Overstock = on-hand − capacity. &ldquo;Days to clear&rdquo; is how long the excess takes to burn off at the current monthly sales rate.
      </p>
    </div>
  );
}

function Th({ children, sortKey, current, dir, onToggle, align = "left" }: {
  children: React.ReactNode; sortKey: SortKey; current: SortKey; dir: "asc" | "desc";
  onToggle: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th className={(align === "right" ? "text-right" : "text-left") + " px-3 py-2 font-medium"}>
      <button type="button" onClick={() => onToggle(sortKey)}
        className={"inline-flex items-center gap-1 hover:text-sand-700 " + (active ? "text-sand-700" : "")}>
        {children}
        {active && <span>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}
