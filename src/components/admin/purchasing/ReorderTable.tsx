"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SOP_LABEL_DISPLAY,
  type Category,
  type InventoryForecast,
  type OrderType,
  type ProductWithMetrics,
  type PurchasingSettings,
  type SopLabel,
} from "@/lib/purchasing/types";
import ForecastDrawer from "./ForecastDrawer";

const ACTIONABLE_STATUSES: SopLabel[] = [
  "reorder_plus_montreal",
  "montreal_transfer",
  "reorder",
];

interface Props {
  initialProducts: ProductWithMetrics[];
  initialForecasts: Record<string, InventoryForecast>;
  settings: PurchasingSettings;
}

const SOP_BADGE: Record<SopLabel, string> = {
  reorder_plus_montreal: "bg-red-50 text-red-700 border-red-200",
  montreal_transfer: "bg-orange-50 text-orange-700 border-orange-200",
  reorder: "bg-amber-50 text-amber-700 border-amber-200",
  no_sales_data: "bg-sand-100 text-sand-600 border-sand-200",
  ok: "bg-green-50 text-green-700 border-green-200",
};

function fmt(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-CA", { maximumFractionDigits: digits });
}
function fmtCAD(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

export default function ReorderTable({ initialProducts, initialForecasts, settings }: Props) {
  const router = useRouter();
  const [forecastId, setForecastId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("glass");
  const [showOk, setShowOk] = useState(false);
  const [search, setSearch] = useState("");
  // null = show all actionable statuses; otherwise pin to a single one.
  const [statusFilter, setStatusFilter] = useState<SopLabel | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState<OrderType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusCounts = useMemo(() => {
    const counts: Record<SopLabel, number> = {
      reorder_plus_montreal: 0,
      montreal_transfer: 0,
      reorder: 0,
      ok: 0,
      no_sales_data: 0,
    };
    for (const p of initialProducts) counts[p.sop_label]++;
    return counts;
  }, [initialProducts]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialProducts.filter((p) => {
      if (p.category !== category) return false;
      if (!showOk && p.sop_label === "ok") return false;
      if (statusFilter && p.sop_label !== statusFilter) return false;
      if (q && !p.sku.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialProducts, category, showOk, statusFilter, search]);

  const selected = useMemo(() => {
    const rows: Array<{ product: ProductWithMetrics; qty: number; lineValue: number }> = [];
    for (const p of initialProducts) {
      const raw = quantities[p.id];
      if (!raw) continue;
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      rows.push({ product: p, qty: n, lineValue: n * p.unit_cost_landed });
    }
    return rows;
  }, [initialProducts, quantities]);

  const totalQty = selected.reduce((s, r) => s + r.qty, 0);
  const totalValue = selected.reduce((s, r) => s + r.lineValue, 0);

  // Two independent actions per SKU:
  //   applyTransfer  → loads the Montreal bridge qty into Order qty
  //   applySuggested → loads the crate-rounded China refill into Order qty
  function applyTransfer(p: ProductWithMetrics) {
    setQuantities((q) => ({ ...q, [p.id]: String(p.transfer_requirement) }));
  }
  function applySuggested(p: ProductWithMetrics) {
    setQuantities((q) => ({ ...q, [p.id]: String(p.suggested_qty) }));
  }
  function applyAllSuggested() {
    const next: Record<string, string> = { ...quantities };
    for (const p of visible) if (p.suggested_qty > 0) next[p.id] = String(p.suggested_qty);
    setQuantities(next);
  }
  function applyAllTransfer() {
    const next: Record<string, string> = { ...quantities };
    for (const p of visible) if (p.transfer_requirement > 0) next[p.id] = String(p.transfer_requirement);
    setQuantities(next);
  }
  function clearAll() { setQuantities({}); }

  async function createDraftPO(order_type: OrderType) {
    if (selected.length === 0) return;
    setCreating(order_type); setError(null);
    try {
      const res = await fetch("/api/purchasing/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_type,
          notes: notes || null,
          items: selected.map((r) => ({ product_id: r.product.id, qty_ordered: r.qty })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create order");
      }
      const data = await res.json();
      router.push(`/warehouse/purchasing/orders/${data.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
      setCreating(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
          {(["glass", "hardware"] as const).map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={"px-3 py-1.5 text-sm capitalize " + (category === c ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>
              {c}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-sand-700 px-2">
          <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} />
          Show products that don&apos;t need reordering
        </label>
        <input type="text" placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 flex-1 min-w-[200px]" />
        <button type="button" onClick={applyAllSuggested}
          className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50">Apply suggested (China) to all</button>
        <button type="button" onClick={applyAllTransfer}
          className="px-3 py-1.5 text-sm rounded-lg border border-orange-300 bg-white text-orange-700 hover:bg-orange-50">Apply transfer (MTL) to all</button>
        <button type="button" onClick={clearAll}
          className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50">Clear</button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-sand-500 uppercase tracking-wider font-medium">Filter:</span>
        <button type="button" onClick={() => setStatusFilter(null)}
          className={"px-3 py-1 text-xs rounded-full border " +
            (statusFilter === null
              ? "bg-accent text-white border-accent"
              : "bg-white text-sand-700 border-sand-300 hover:bg-sand-50")}>
          All actionable
        </button>
        {ACTIONABLE_STATUSES.map((s) => {
          const active = statusFilter === s;
          const count = statusCounts[s] ?? 0;
          if (count === 0 && !active) return null;
          const color = s === "reorder_plus_montreal" ? "red" : s === "montreal_transfer" ? "orange" : "amber";
          return (
            <button key={s} type="button"
              onClick={() => setStatusFilter(active ? null : s)}
              className={"px-3 py-1 text-xs rounded-full border " +
                (active
                  ? `bg-${color}-600 text-white border-${color}-600`
                  : `bg-${color}-50 text-${color}-700 border-${color}-200 hover:bg-${color}-100`)}>
              {SOP_LABEL_DISPLAY[s]} ({count})
            </button>
          );
        })}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 z-20 bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">SKU</th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">On hand</th>
              <th className="text-right px-3 py-2 font-medium">Inbound</th>
              <th className="text-right px-3 py-2 font-medium">Capacity</th>
              <th className="text-right px-3 py-2 font-medium" title="Average monthly sales = GRS + RF channels">Monthly</th>
              <th className="text-right px-3 py-2 font-medium" title="Days you can keep selling using only what's on hand (ignores inbound): on_hand / (monthly / 30) — seasonality and growth applied.">Days left</th>
              <th className="text-right px-3 py-2 font-medium" title="The exact math result — reach the restock target after covering lead-time demand">Perfect</th>
              <th className="text-right px-3 py-2 font-medium" title="Minimum to transfer from Montreal so we don't stock out before the next China shipment lands. Click to copy into Order qty (then use 'Create draft Montreal transfer'). Independent of the China refill on the right — for a 'Reorder + Montreal transfer' SKU you may want to do BOTH (a Montreal transfer now AND a China order to refill long-term).">Transfer</th>
              <th className="text-right px-3 py-2 font-medium" title="Crate-rounded China refill — what you'd actually order from the main supplier. Click to copy into Order qty (then use 'Create draft China order').">Suggested</th>
              <th className="text-right px-3 py-2 font-medium">Order qty</th>
              <th className="text-right px-3 py-2 font-medium">Line value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visible.map((p) => {
              const raw = quantities[p.id] ?? "";
              const q = parseFloat(raw);
              const lineValue = Number.isFinite(q) ? q * p.unit_cost_landed : 0;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      {p.sku}
                      <button type="button" onClick={() => setForecastId(p.id)} title="Projected inventory & how the order point was calculated"
                        className="text-sand-400 hover:text-accent text-sm">📈</button>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sand-700">{p.name}</td>
                  <td className="px-3 py-2">
                    <span className={"inline-block px-2 py-0.5 rounded-md border text-[11px] " + (SOP_BADGE[p.sop_label] ?? "bg-sand-100 text-sand-600 border-sand-200")}>
                      {SOP_LABEL_DISPLAY[p.sop_label] ?? p.sop_label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(p.current_inventory, 0)}</td>
                  <td className="px-3 py-2 text-right text-sand-500">{p.inbound > 0 ? fmt(p.inbound, 0) : "—"}</td>
                  <td className="px-3 py-2 text-right text-sand-500">{fmt(p.storage_capacity, 0)}</td>
                  <td className="px-3 py-2 text-right text-sand-500">{fmt(p.avg_monthly_sales_grs + p.avg_monthly_sales_rf, 1)}</td>
                  <td className="px-3 py-2 text-right">{fmt(p.days_of_stock_left, 0)}</td>
                  <td className="px-3 py-2 text-right text-sand-600 tabular-nums">
                    {fmt(p.perfect_qty, 0)}
                    {p.inbound > 0 && (
                      <div className="text-[10px] text-sand-400 tabular-nums">after {fmt(p.inbound, 0)} in transit</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.transfer_requirement > 0 ? (
                      <button
                        type="button"
                        onClick={() => applyTransfer(p)}
                        className="text-orange-700 font-medium hover:underline"
                        title="Click to copy into Order qty for a Montreal transfer"
                      >
                        {fmt(p.transfer_requirement, 0)}
                      </button>
                    ) : (
                      <span className="text-sand-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.suggested_qty > 0 ? (
                      <button
                        type="button"
                        onClick={() => applySuggested(p)}
                        className="text-accent hover:underline tabular-nums"
                        title="Click to copy into Order qty for a China order"
                      >
                        {fmt(p.suggested_qty, 0)}
                      </button>
                    ) : (
                      <span className="text-sand-300 tabular-nums">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1 text-right">
                    <input type="number" step="any" min="0" value={raw}
                      onChange={(e) => setQuantities((qmap) => ({ ...qmap, [p.id]: e.target.value }))}
                      placeholder="0"
                      className="w-20 px-1.5 py-1 text-right rounded border border-sand-300 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
                  </td>
                  <td className="px-3 py-2 text-right text-sand-700">{lineValue > 0 ? fmtCAD(lineValue) : "—"}</td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={14} className="px-3 py-10 text-center text-sand-500">
                Nothing needs reordering right now. Toggle &ldquo;Show products that don&apos;t need reordering&rdquo; above to top up anyway.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl border border-sand-200/60 p-4 flex flex-wrap items-center gap-4">
        <div className="text-sm">
          <span className="text-sand-500">Selected:</span> <span className="font-semibold text-sand-900">{selected.length} {selected.length === 1 ? "line" : "lines"}</span>
          {" · "}<span className="text-sand-500">Qty:</span> <span className="font-semibold tabular-nums">{fmt(totalQty, 0)}</span>
          {" · "}<span className="text-sand-500">Value:</span> <span className="font-semibold tabular-nums">{fmtCAD(totalValue)}</span>
        </div>
        <input type="text" placeholder="Notes (optional, saved on the PO)" value={notes} onChange={(e) => setNotes(e.target.value)}
          className="flex-1 min-w-[240px] px-3 py-1.5 text-sm rounded-lg border border-sand-300" />
        <button type="button" onClick={() => createDraftPO("china")}
          disabled={selected.length === 0 || creating !== null}
          title="Create a draft purchase order to the China supplier (~90-day lead)"
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed">
          {creating === "china" ? "Creating…" : "Create draft China order"}
        </button>
        <button type="button" onClick={() => createDraftPO("montreal")}
          disabled={selected.length === 0 || creating !== null}
          title="Create a draft internal transfer from the Montreal warehouse (fast)"
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:bg-sand-300 disabled:cursor-not-allowed">
          {creating === "montreal" ? "Creating…" : "Create draft Montreal transfer"}
        </button>
      </div>
      {forecastId && (() => {
        const p = initialProducts.find((x) => x.id === forecastId);
        if (!p) return null;
        return (
          <ForecastDrawer product={p} forecast={initialForecasts[forecastId] ?? null}
            settings={settings} onClose={() => setForecastId(null)} />
        );
      })()}
    </div>
  );
}
