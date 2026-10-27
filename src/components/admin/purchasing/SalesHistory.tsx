"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { SalesOverview, SalesSource } from "@/lib/purchasing/sales-types";
const fmt = (n: number) => Number(n).toLocaleString("en-CA", { maximumFractionDigits: 1 });
const monthLabel = (month: string) => new Date(`${month.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
const methods: Record<string, string> = { sku: "SKU match", specification: "Estimated match", approved: "Reviewed match", excluded: "Excluded", review: "Needs review", outside_catalog: "Outside catalog" };
export default function SalesHistory({ initial, initialSku }: { initial: SalesOverview; initialSku?: string }) {
  const { data = initial, mutate } = useSWR<SalesOverview>("/api/purchasing/sales", { fallbackData: initial, refreshInterval: 60_000 });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<string | null>(initial.products.find(p => p.sku === initialSku)?.id ?? null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewFilter, setReviewFilter] = useState("review");
  const [sourceSearch, setSourceSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const sourceUrl = reviewing ? "/api/purchasing/sales?sources=1" : selected ? `/api/purchasing/sales?sources=1&product_id=${selected}` : null;
  const { data: sourceData, error: sourceError, mutate: mutateSources, isLoading } = useSWR<{ sources: SalesSource[] }>(sourceUrl);
  const currentMonth = data.seasonality.month;
  const factor = data.seasonality.multiplier;
  const monthEnd = data.snapshot?.period_end ?? currentMonth;
  const lastMonth = new Date(`${monthEnd}T12:00:00Z`); lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  const lastKey = lastMonth.toISOString().slice(0, 7) + "-01";
  const monthly = data.monthly;
  const byProduct = useMemo(() => {
    const rows = new Map<string, typeof monthly>();
    for (const m of monthly) { const list = rows.get(m.product_id) ?? []; list.push(m); rows.set(m.product_id, list); }
    return rows;
  }, [monthly]);
  const visible = data.products.filter(p => (category === "all" || p.category === category) && `${p.sku} ${p.name}`.toLowerCase().includes(search.toLowerCase()));
  const product = data.products.find(p => p.id === selected);
  const productMonths = useMemo(() => byProduct.get(selected ?? "") ?? [], [byProduct, selected]);
  const months = useMemo(() => {
    const first = [...productMonths.map(m => m.month), data.snapshot?.period_start ?? currentMonth].sort()[0];
    const list: string[] = [];
    for (const d = new Date(`${first}T12:00:00Z`); d.toISOString().slice(0, 10) <= currentMonth; d.setUTCMonth(d.getUTCMonth() + 1)) list.push(d.toISOString().slice(0, 10));
    return list.reverse();
  }, [productMonths, data.snapshot?.period_start, currentMonth]);
  const sources = (sourceData?.sources ?? []).filter(s => (!reviewing || reviewFilter === "all" || (s.method === reviewFilter && (reviewFilter !== "review" || s.units > 0))) && `${s.sku ?? ""} ${s.title} ${s.variant_title ?? ""}`.toLowerCase().includes(sourceSearch.toLowerCase()));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold text-sand-900">Sales behind your stock plan</h2>
        <p className="mt-1 max-w-3xl text-sm text-sand-600">Net units from RF and GRS orders, with older listings consolidated by SKU or matching specifications. Refunds and removed quantities are deducted from the original order month. Cancelled and test orders are excluded.</p>
      </div>
      <button type="button" onClick={() => { setReviewing(!reviewing); setSourceSearch(""); }} className="rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm font-medium">{reviewing ? "Back to products" : `Review matches (${data.snapshot?.review_sources ?? 0})`}</button>
    </div>
    <div className="rounded-xl border border-sand-200 bg-white p-4 text-sm">
      <strong>Monthly sales: annual units ÷ 12 × {fmt(factor)} seasonality for {monthLabel(currentMonth)}. </strong><br />Annual history: {data.snapshot ? `${monthLabel(data.snapshot.period_start)} to ${monthLabel(lastKey)}, divided by 12 including zero-sale months.` : "Waiting for both stores to finish importing."}
      <span className="mt-1 block text-sand-600">Actual sales this month are shown separately. Growth settings apply separately to the stock forecast. Hardware quantities use the purchasing SKU&apos;s unit, including one hinge kit as one kit.</span>
    </div>
    {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    {!reviewing && <>
      <div className="flex flex-wrap gap-3">
        <input aria-label="Search sales products" placeholder="Search SKU or product" value={search} onChange={e => setSearch(e.target.value)} className="min-w-48 flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm" />
        <select aria-label="Product category" value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border border-sand-300 px-3 py-2 text-sm"><option value="all">All products</option><option value="glass">Glass</option><option value="hardware">Hardware</option></select>
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full min-w-[760px] text-sm tabular-nums"><thead className="sticky top-0 z-20 bg-sand-50 text-xs text-sand-600"><tr>
          <th className="sticky left-0 z-30 min-w-60 bg-sand-50 p-3 text-left">Product</th><th className="p-3 text-right">RF seasonal / month</th><th className="p-3 text-right">GRS seasonal / month</th><th className="p-3 text-right">Combined seasonal / month</th><th className="p-3 text-right">{monthLabel(lastKey)}</th><th className="p-3 text-right">{monthLabel(currentMonth)} so far</th><th className="p-3 text-left">Basis</th>
        </tr></thead><tbody className="divide-y divide-sand-100">{visible.map(p => {
          const rows = byProduct.get(p.id) ?? [];
          const total = (m: string) => rows.filter(r => r.month === m).reduce((sum, r) => sum + Number(r.units), 0);
          const estimated = rows.some(r => Number(r.estimated_units) > 0);
          return <tr key={p.id} className={selected === p.id ? "bg-blue-50" : "hover:bg-sand-50"}>
            <td className="sticky left-0 bg-white p-3"><button type="button" onClick={() => { setSelected(p.id); setSourceSearch(""); }} className="text-left text-accent hover:underline"><span className="block font-mono text-xs font-semibold">{p.sku}</span><span className="mt-0.5 block max-w-72 text-xs text-sand-600">{p.name.replaceAll("\u2014", "-")}</span></button></td>
            <td className="p-3 text-right">{fmt(Number(p.avg_monthly_sales_rf) * factor)}</td><td className="p-3 text-right">{fmt(Number(p.avg_monthly_sales_grs) * factor)}</td><td className="p-3 text-right font-semibold">{fmt((Number(p.avg_monthly_sales_rf) + Number(p.avg_monthly_sales_grs)) * factor)}<span className="mt-1 block text-[10px] font-normal text-sand-500">Base {fmt(Number(p.avg_monthly_sales_rf) + Number(p.avg_monthly_sales_grs))} × {fmt(factor)}</span></td>
            <td className="p-3 text-right">{p.sales_updated_at ? fmt(total(lastKey)) : "Not synced"}</td><td className="p-3 text-right">{p.sales_updated_at ? fmt(total(currentMonth)) : "Not synced"}</td><td className="p-3 text-xs">{!p.sales_updated_at ? "Manual baseline" : estimated ? "Includes estimated matches" : "Matched history"}</td>
          </tr>;
        })}</tbody></table>
        {visible.length === 0 && <p className="p-8 text-center text-sm text-sand-500">No matching products.</p>}
      </div>
    </>}
    {(reviewing || product) && <section className="space-y-4 rounded-xl border border-sand-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-sand-900">{reviewing ? "Historical product matches" : `${product?.sku}: monthly history`}</h3><p className="mt-1 text-sm text-sand-600">{reviewing ? "Unclear lines stay out of calculated sales until reviewed. Outside-catalog items include shipping, custom glass, and products you do not stock here." : "Click another product above to compare its history. Estimated matches are identified below."}</p></div>{!reviewing && <button type="button" onClick={() => setSelected(null)} className="text-sm text-sand-500">Close</button>}</div>
      {!reviewing && <div className="max-h-80 overflow-auto rounded-lg border border-sand-200"><table className="w-full text-sm tabular-nums"><thead className="sticky top-0 bg-sand-50"><tr><th className="p-2 text-left">Month</th><th className="p-2 text-right">RF</th><th className="p-2 text-right">GRS</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Estimated portion</th></tr></thead><tbody>{months.map(month => {
        const rows = productMonths.filter(m => m.month === month);
        const rf = rows.filter(m => m.store_id === "store1").reduce((n, m) => n + Number(m.units), 0);
        const grs = rows.filter(m => m.store_id === "store2").reduce((n, m) => n + Number(m.units), 0);
        const estimated = rows.reduce((n, m) => n + Number(m.estimated_units), 0);
        return <tr key={month} className="border-t border-sand-100"><td className="p-2">{monthLabel(month)}{month === currentMonth ? " (so far)" : ""}</td><td className="p-2 text-right">{fmt(rf)}</td><td className="p-2 text-right">{fmt(grs)}</td><td className="p-2 text-right font-medium">{fmt(rf + grs)}</td><td className="p-2 text-right">{fmt(estimated)}</td></tr>;
      })}</tbody></table></div>}
      <div className="flex flex-wrap gap-3"><input aria-label="Search historical listings" placeholder="Search historical names or SKUs" value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} className="min-w-48 flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm" />{reviewing && <select aria-label="Match status" value={reviewFilter} onChange={e => setReviewFilter(e.target.value)} className="rounded-lg border border-sand-300 px-3 py-2 text-sm"><option value="review">Needs review</option><option value="specification">Estimated matches</option><option value="outside_catalog">Outside catalog</option><option value="approved">Reviewed matches</option><option value="excluded">Excluded</option><option value="all">All listings</option></select>}</div>
      {isLoading && <p role="status" className="text-sm text-sand-500">Loading original listings...</p>}
      {sourceError && <p role="alert" className="text-sm text-red-700">Could not load the original listings. Please try again.</p>}
      {!isLoading && !sourceError && sources.length === 0 && <p className="text-sm text-sand-500">No listings in this view.</p>}
      <div className="max-h-[65vh] space-y-3 overflow-auto">{sources.map(source => <SourceRow key={source.source_key} source={source} products={data.products} editable={reviewing} onSaved={async published => {
        setMessage(published ? "Match saved. Monthly totals and reorder baselines have been updated." : "Match saved. The next complete store sync will update the totals.");
        await Promise.all([mutate(), mutateSources()]);
      }} />)}</div>
    </section>}
  </div>;
}
function SourceRow({ source, products, editable, onSaved }: { source: SalesSource; products: SalesOverview["products"]; editable: boolean; onSaved: (published: boolean) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [productId, setProductId] = useState(source.product_id ?? "");
  const [multiplier, setMultiplier] = useState(String(source.unit_multiplier));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(exclude: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/purchasing/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_key: source.source_key, product_id: exclude ? null : productId, unit_multiplier: exclude ? 1 : Number(multiplier) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save match");
      await onSaved(data.published); setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save match"); } finally { setBusy(false); }
  }
  return <div className="rounded-lg border border-sand-200 p-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="font-medium break-words">{source.title.replaceAll("\u2014", "-")}{source.variant_title ? ` / ${source.variant_title.replaceAll("\u2014", "-")}` : ""}</p><p className="mt-1 text-xs text-sand-600">{source.store_id === "store1" ? "RF" : "GRS"} · {source.sku || "No SKU"} · {fmt(source.units)} net units in available history · {methods[source.method]}</p><p className="mt-1 text-xs text-sand-500">{source.reason}{source.unit_multiplier !== 1 ? ` · ${source.unit_multiplier} purchasing units per sold unit` : ""}</p></div>{editable && <button type="button" onClick={() => setEditing(!editing)} className="text-accent">{editing ? "Cancel" : "Review"}</button>}</div>
    {editing && <div className="mt-3 flex flex-wrap items-end gap-3"><label className="flex-1 text-xs">Purchasing product<select aria-label={`Purchasing product for ${source.title}`} value={productId} onChange={e => setProductId(e.target.value)} className="mt-1 block w-full rounded border border-sand-300 p-2 text-sm"><option value="">Choose a product</option>{products.map(p => <option key={p.id} value={p.id}>{p.sku}: {p.name.replaceAll("\u2014", "-")}</option>)}</select></label><label className="text-xs">Units per sold unit<input type="number" min="0.001" max="10000" step="any" value={multiplier} onChange={e => setMultiplier(e.target.value)} className="mt-1 block w-28 rounded border border-sand-300 p-2 text-sm" /></label><button type="button" disabled={busy || !productId} onClick={() => save(false)} className="rounded bg-accent px-3 py-2 text-white disabled:opacity-50">Save match</button><button type="button" disabled={busy} onClick={() => save(true)} className="rounded border border-sand-300 px-3 py-2 disabled:opacity-50">Exclude</button></div>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </div>;
}
