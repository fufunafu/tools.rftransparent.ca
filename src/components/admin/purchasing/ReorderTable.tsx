"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { seasonalMonthlySales } from "@/lib/purchasing/seasonality";
import { formatCADWhole } from "@/lib/format";
import { SOP_LABEL_DISPLAY, ORDER_TYPE_DISPLAY, type Category, type InventoryForecast, type OrderType, type ProductWithMetrics, type PurchasingSettings } from "@/lib/purchasing/types";
import PurchasingPageHeader from "./PurchasingPageHeader";
import ProductFilters from "./ProductFilters";

const ForecastDrawer = dynamic(() => import("./ForecastDrawer"), { ssr: false });
interface Props { initialProducts: ProductWithMetrics[]; initialForecasts: Record<string, InventoryForecast>; settings: PurchasingSettings }
const fmt = (n: number | null, digits = 0) => n === null || !Number.isFinite(n) ? "-" : n.toLocaleString("en-CA", { maximumFractionDigits: digits });
const recommendation = (p: ProductWithMetrics, type: OrderType) => type === "china" ? p.suggested_qty : p.transfer_requirement;

export default function ReorderTable({ initialProducts, initialForecasts, settings }: Props) {
  const router = useRouter();
  const [forecastId, setForecastId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("china");
  const [drafts, setDrafts] = useState<Record<OrderType, Record<string, string>>>({ china: {}, montreal: {} });
  const [notes, setNotes] = useState<Record<OrderType, string>>({ china: "", montreal: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantities = drafts[orderType];
  const visible = useMemo(() => initialProducts.filter(p =>
    (category === "all" || p.category === category) &&
    (showAll || recommendation(p, orderType) > 0) &&
    `${p.sku} ${p.name}`.toLowerCase().includes(search.trim().toLowerCase())
  ), [initialProducts, category, showAll, orderType, search]);
  const selected = useMemo(() => initialProducts.flatMap(product => {
    const qty = Number(quantities[product.id]);
    return Number.isFinite(qty) && qty > 0 ? [{ product, qty, lineValue: qty * product.unit_cost_landed }] : [];
  }), [initialProducts, quantities]);
  const totalQty = selected.reduce((sum, row) => sum + row.qty, 0);
  const totalValue = selected.reduce((sum, row) => sum + row.lineValue, 0);
  const visibleIds = new Set(visible.map(p => p.id));
  const hiddenSelected = selected.filter(row => !visibleIds.has(row.product.id)).length;
  const invalidQuantity = Object.values(quantities).some(value => value.trim() !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0));
  const recommendationCount = (type: OrderType) => initialProducts.filter(p => recommendation(p, type) > 0).length;

  function setQuantity(id: string, value: string) {
    setDrafts(current => ({ ...current, [orderType]: { ...current[orderType], [id]: value } }));
  }
  function fillSuggested() {
    setDrafts(current => {
      const next = { ...current[orderType] };
      for (const p of visible) if (recommendation(p, orderType) > 0) next[p.id] = String(recommendation(p, orderType));
      return { ...current, [orderType]: next };
    });
  }
  async function createDraft() {
    if (!selected.length || invalidQuantity || creating) return;
    setCreating(true); setError(null);
    try {
      const response = await fetch("/api/purchasing/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_type: orderType, notes: notes[orderType] || null, items: selected.map(row => ({ product_id: row.product.id, qty_ordered: row.qty })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create the draft order.");
      router.push(`/warehouse/purchasing/orders/${data.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the draft order.");
      setCreating(false);
    }
  }

  return <div className="space-y-4">
    <PurchasingPageHeader title="Plan your next order" description="Choose the source, review suggested quantities, then create a draft for approval and tracking." actions={<Link href="/warehouse/purchasing/orders" className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm font-medium hover:bg-sand-50">View purchase orders</Link>} />
    <div className="grid grid-cols-2 gap-3" role="group" aria-label="Order source">
      {(["china", "montreal"] as const).map(type => <button type="button" key={type} disabled={creating} aria-pressed={orderType === type}
        onClick={() => { setOrderType(type); setError(null); }}
        className={"rounded-xl border p-4 text-left transition-colors disabled:opacity-50 " + (orderType === type ? "border-accent bg-blue-50/60 ring-1 ring-accent" : "border-sand-200 bg-white hover:border-sand-400")}>
        <span className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-sand-900">{ORDER_TYPE_DISPLAY[type]}</span><span className="rounded-full bg-white px-2 py-0.5 text-xs tabular-nums text-sand-600">{recommendationCount(type)} suggested</span></span>
        <span className="mt-1 hidden text-xs leading-relaxed text-sand-500 sm:block">{type === "china" ? `Replenish from the main supplier. Planning lead time: ${settings.lead_time_days} days.` : "Move stock from Montreal to cover a shortage before replenishment arrives."}</span>
      </button>)}
    </div>
    <div className="space-y-3 rounded-xl border border-sand-200 bg-white p-3 sm:p-4">
      <ProductFilters category={category} onCategory={setCategory} search={search} onSearch={setSearch} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-4"><span className="font-medium text-sand-900">{visible.length} products shown</span><label className="inline-flex items-center gap-2 text-sand-600"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Include products without a suggestion</label></div>
        <button type="button" onClick={fillSuggested} disabled={creating || !visible.some(p => recommendation(p, orderType) > 0)} className="font-medium text-accent hover:underline disabled:opacity-40">Fill suggested quantities for shown products</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-2">
        <div className="max-h-[65vh] overflow-auto rounded-xl border border-sand-200 bg-white">
          <table className="w-full min-w-[320px] text-sm tabular-nums md:min-w-[850px]">
            <caption className="sr-only">{ORDER_TYPE_DISPLAY[orderType]} recommendations. Edit quantities to add products to your draft.</caption>
            <thead className="sticky top-0 z-20 bg-sand-50 text-xs text-sand-500"><tr>
              <th scope="col" className="sticky left-0 z-30 min-w-36 bg-sand-50 md:min-w-48 px-3 py-3 text-left font-medium">Product</th>
              <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">On hand</th>
              <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">Inbound</th>
              <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">Monthly demand</th>
              <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">Days of stock</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Suggested qty</th>
              <th scope="col" className="bg-blue-50 px-3 py-3 text-right font-semibold text-accent">Your qty</th>
              <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">Value</th>
            </tr></thead>
            <tbody className="divide-y divide-sand-100">{visible.map(p => {
              const raw = quantities[p.id] ?? "";
              const qty = Number(raw);
              const suggested = recommendation(p, orderType);
              const valid = raw === "" || (Number.isFinite(qty) && qty >= 0);
              return <tr key={p.id} className={qty > 0 ? "bg-blue-50/30" : "hover:bg-sand-50/60"}>
                <td className="sticky left-0 z-10 min-w-36 bg-white md:min-w-48 px-3 py-3">
                  <button type="button" onClick={() => setForecastId(p.id)} aria-label={`View forecast for ${p.sku}`} className="block text-left"><span className="block font-mono text-xs font-semibold text-accent hover:underline">{p.sku}</span><span className="mt-1 block max-w-56 text-xs text-sand-600">{p.name.replaceAll("\u2014", "-")}</span>{(p.planning?.unconfirmed_inbound ?? 0) > 0 && <span className="mt-1 block text-[10px] text-amber-700">Confirm overdue or missing ETA before ordering</span>}</button>
                  {p.sop_label !== "ok" && <span className={"mt-1.5 inline-block text-[10px] font-medium " + (p.sop_label.includes("montreal") ? "text-orange-700" : "text-sand-500")}>{SOP_LABEL_DISPLAY[p.sop_label]}</span>}
                </td>
                <td className="hidden md:table-cell px-3 py-3 text-right">{fmt(p.current_inventory)}</td>
                <td className="hidden md:table-cell px-3 py-3 text-right text-sand-500">{p.inbound > 0 ? fmt(p.inbound) : "-"}</td>
                <td className="hidden md:table-cell px-3 py-3 text-right"><Link href={`/warehouse/purchasing/sales?sku=${encodeURIComponent(p.sku)}`} className="text-accent hover:underline">{fmt(seasonalMonthlySales(p.avg_monthly_sales_grs + p.avg_monthly_sales_rf, settings), 1)}</Link></td>
                <td className="hidden md:table-cell px-3 py-3 text-right">{fmt(p.days_of_stock_left)}</td>
                <td className="px-3 py-3 text-right"><button type="button" disabled={!suggested || creating} onClick={() => setQuantity(p.id, String(suggested))} aria-label={`Use suggested quantity for ${p.sku}`} className="font-medium text-accent hover:underline disabled:text-sand-400">{fmt(suggested)}</button>{orderType === "china" && suggested > 0 && <span className="mt-1 block text-[10px] text-sand-400">Before rounding: {fmt(p.perfect_qty)}</span>}</td>
                <td className="bg-blue-50/40 px-3 py-2 text-right"><input type="number" min="0" step="any" value={raw} aria-label={`Order quantity for ${p.sku}`} aria-invalid={!valid} disabled={creating} onChange={e => setQuantity(p.id, e.target.value)} placeholder="0" className="w-20 rounded-lg border border-sand-300 bg-white px-2 py-2 text-right focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent aria-invalid:border-red-500" /></td>
                <td className="hidden md:table-cell px-3 py-3 text-right text-sand-600">{valid && qty > 0 ? formatCADWhole(qty * p.unit_cost_landed) : "-"}</td>
              </tr>;
            })}</tbody>
          </table>
          {visible.length === 0 && <div className="px-4 py-12 text-center"><p className="text-sm font-medium text-sand-700">No products match this view.</p><p className="mt-1 text-xs text-sand-500">Change the filters or include products without a suggestion to plan a manual top-up.</p></div>}
        </div>
        <p className="text-xs leading-relaxed text-sand-500">Suggested quantities account for current stock and inbound orders. Select a product to see the full calculation and arrival forecast.</p>
      </div>
      <aside aria-label="Draft order summary" className="order-first rounded-xl border border-sand-200 bg-white p-4 xl:sticky xl:top-4 xl:order-last">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-sand-900">Your draft</h3><span className="text-xs text-sand-500">{ORDER_TYPE_DISPLAY[orderType]}</span></div>
        <div className="mt-3 flex items-end justify-between gap-3"><div><span className="text-2xl font-semibold tabular-nums tracking-tight text-sand-900">{formatCADWhole(totalValue)}</span><p className="mt-1 text-xs text-sand-500">{selected.length} products · {fmt(totalQty, 1)} units</p></div>{selected.length > 0 && <button type="button" disabled={creating} onClick={() => setDrafts(current => ({ ...current, [orderType]: {} }))} className="text-xs text-sand-500 hover:text-red-700">Clear draft</button>}</div>
        {selected.length > 0 ? <details className="mt-3 border-t border-sand-100 pt-3"><summary className="cursor-pointer text-xs font-medium text-accent">Review selected products{hiddenSelected > 0 ? ` (${hiddenSelected} hidden by filters)` : ""}</summary><ul className="mt-2 max-h-48 space-y-2 overflow-auto">{selected.map(row => <li key={row.product.id} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0"><span className="font-mono">{row.product.sku}</span><span className="ml-2 text-sand-500">× {fmt(row.qty, 1)}</span></span><button type="button" disabled={creating} onClick={() => setQuantity(row.product.id, "")} aria-label={`Remove ${row.product.sku} from draft`} className="text-sand-500 hover:text-red-700">Remove</button></li>)}</ul></details> : <p className="mt-3 hidden text-xs leading-relaxed text-sand-500 sm:block">Enter quantities or use the suggestions to build this order. China and Montreal quantities are kept separately while you stay on this page.</p>}
        <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-sand-600">Add order notes</summary><label className="mt-2 block text-xs font-medium text-sand-600">Order notes <span className="font-normal text-sand-400">(optional)</span><textarea rows={2} value={notes[orderType]} disabled={creating} onChange={e => setNotes(current => ({ ...current, [orderType]: e.target.value }))} className="mt-1.5 block w-full resize-y rounded-lg border border-sand-300 px-3 py-2 text-sm font-normal" placeholder="Add a note for this order" /></label></details>
        {invalidQuantity && <p role="alert" className="mt-2 text-xs text-red-700">Quantities must be zero or more. Correct the highlighted entry before creating a draft.</p>}
        <button type="button" disabled={!selected.length || creating || invalidQuantity} onClick={createDraft} className="mt-3 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-sand-200 disabled:text-sand-500">{creating ? "Creating draft…" : `Create draft ${orderType === "china" ? "China order" : "Montreal transfer"}`}</button>
        <p className="mt-2 text-center text-[11px] text-sand-400">Creates an internal draft. Nothing is sent to a supplier.</p>
      </aside>
    </div>
    {forecastId && (() => {
      const product = initialProducts.find(p => p.id === forecastId);
      return product ? <ForecastDrawer product={product} forecast={initialForecasts[forecastId] ?? null} settings={settings} onClose={() => setForecastId(null)} /> : null;
    })()}
  </div>;
}
