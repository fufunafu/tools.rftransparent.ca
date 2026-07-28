"use client";

import { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import {
  SOP_LABEL_DISPLAY,
  type Category,
  type InventoryForecast,
  type ProductWithMetrics,
  type PurchasingSettings,
  type SopLabel,
} from "@/lib/purchasing/types";
import { rowsToCSV, parseCSV } from "@/lib/purchasing/csv";
import dynamic from "next/dynamic";

// Loaded on demand so recharts stays out of the route's initial bundle.
const ForecastDrawer = dynamic(() => import("./ForecastDrawer"), { ssr: false });
import AddProductDialog from "./AddProductDialog";
import RecentActivityPanel from "./RecentActivityPanel";
import BulkUploadPreviewDialog, { type BulkChange } from "./BulkUploadPreviewDialog";
import ColumnHint from "./ColumnHint";
import { formatCADWhole } from "@/lib/format";

type BulkResult = {
  applied: number;
  unchanged: number;
  skipped: Array<{ sku: string; reason: string }>;
  total: number;
};

interface Props {
  initialProducts: ProductWithMetrics[];
  initialForecasts: Record<string, InventoryForecast>;
  settings: PurchasingSettings;
}

type SortKey =
  | "sort_order" | "sku" | "current_inventory" | "inbound"
  | "total_inventory" | "storage_capacity" | "daily_sales"
  | "days_of_stock_left" | "days_of_stock_with_inbound"
  | "reorder_point" | "inventory_value" | "overstock";

const SOP_BADGE: Record<SopLabel, string> = {
  reorder_plus_montreal: "bg-red-50 text-red-700 border-red-200",
  montreal_transfer: "bg-orange-50 text-orange-700 border-orange-200",
  reorder: "bg-amber-50 text-amber-700 border-amber-200",
  no_sales_data: "bg-sand-100 text-sand-600 border-sand-200",
  ok: "bg-green-50 text-green-700 border-green-200",
};

function fmtNum(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
function heightBucket(h: number | null): string {
  if (h === null) return "—";
  if (h < 35) return '34"';
  if (h < 42) return '40"';
  return '46"';
}

export default function InventoryTable({ initialProducts, initialForecasts, settings }: Props) {
  const router = useRouter();
  const { data, mutate } = useSWR<{ products: ProductWithMetrics[] }>(
    "/api/purchasing/products",
    { fallbackData: { products: initialProducts }, revalidateOnMount: false },
  );
  const products = data?.products ?? initialProducts;

  const [category, setCategory] = useState<Category>("glass");
  const [height, setHeight] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [pendingRows, setPendingRows] = useState<Array<{ sku: string; on_hand: number }> | null>(null);
  const [previewChanges, setPreviewChanges] = useState<BulkChange[]>([]);
  const [previewUnchanged, setPreviewUnchanged] = useState(0);
  const [previewSkipped, setPreviewSkipped] = useState<Array<{ sku: string; reason: string }>>([]);
  const [forecastSku, setForecastSku] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSalesDetail, setShowSalesDetail] = useState(false);
  const [showPricingDetail, setShowPricingDetail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const heightBuckets = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) set.add(heightBucket(p.height));
    return Array.from(set).sort();
  }, [products]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = products.filter((p) => {
      if (p.category !== category) return false;
      if (height !== "all" && heightBucket(p.height) !== height) return false;
      if (q && !p.sku.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      const aNum = av === null ? -Infinity : Number(av);
      const bNum = bv === null ? -Infinity : Number(bv);
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });
    return rows;
  }, [products, category, height, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "sku" ? "asc" : "desc"); }
  }
  function resetSort() { setSortKey("sort_order"); setSortDir("asc"); }

  function downloadTemplate() {
    const header = ["SKU", "Name", "On Hand"];
    const rows: Array<Array<string | number | null>> = [header];
    for (const p of products) rows.push([p.sku, p.name, p.current_inventory]);
    const csv = rowsToCSV(rows);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url; a.download = `inventory-on-hand-${today}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function applyPendingUpload() {
    if (!pendingRows) return;
    setBulkBusy(true); setError(null);
    try {
      const res = await fetch("/api/purchasing/products/bulk-inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: pendingRows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Apply failed");
      }
      const result = (await res.json()) as BulkResult;
      setBulkResult(result);
      setPendingRows(null); setPreviewChanges([]); setPreviewSkipped([]);
      await mutate(); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally { setBulkBusy(false); }
  }
  function cancelPendingUpload() {
    setPendingRows(null); setPreviewChanges([]); setPreviewSkipped([]); setPreviewUnchanged(0);
  }

  async function handleUpload(file: File) {
    setBulkBusy(true); setError(null); setBulkResult(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) throw new Error("File is empty.");
      const header = parsed[0].map((h) => h.trim().toLowerCase());
      let skuCol = header.indexOf("sku");
      let qtyCol = header.findIndex((h) => ["on hand", "on_hand", "current inventory", "qty", "quantity"].includes(h));
      let dataStart = 1;
      if (skuCol === -1 || qtyCol === -1) { skuCol = 0; qtyCol = 2; dataStart = 0; }
      const rows: Array<{ sku: string; on_hand: number }> = [];
      for (let i = dataStart; i < parsed.length; i++) {
        const r = parsed[i];
        const sku = (r[skuCol] ?? "").trim();
        const qtyRaw = (r[qtyCol] ?? "").trim();
        if (!sku) continue;
        if (qtyRaw === "") continue;
        rows.push({ sku, on_hand: Number(qtyRaw.replace(/,/g, "")) });
      }
      if (rows.length === 0) throw new Error("No rows to apply.");

      const res = await fetch("/api/purchasing/products/bulk-inventory?dry_run=true", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Preview failed");
      }
      const preview = (await res.json()) as BulkResult & { changes: BulkChange[] };
      if (preview.changes.length === 0 && preview.skipped.length === 0) {
        setBulkResult({ applied: 0, unchanged: preview.unchanged, skipped: [], total: preview.total });
        return;
      }
      setPendingRows(rows);
      setPreviewChanges(preview.changes);
      setPreviewUnchanged(preview.unchanged);
      setPreviewSkipped(preview.skipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBulkBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveField(id: string, field: keyof ProductWithMetrics, rawValue: string) {
    const numeric = parseFloat(rawValue);
    const value = Number.isFinite(numeric) ? numeric : 0;
    setSavingId(id); setError(null);
    try {
      const res = await fetch("/api/purchasing/products", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      await mutate(); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally { setSavingId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
          {(["glass", "hardware"] as const).map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={"px-3 py-1.5 text-sm capitalize " + (category === c ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>{c}</button>
          ))}
        </div>
        <select value={height} onChange={(e) => setHeight(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 bg-white">
          <option value="all">All heights</option>
          {heightBuckets.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <input type="text" placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 flex-1 min-w-[200px]" />
        <div className="flex items-center gap-2 ml-auto">
          {sortKey !== "sort_order" && (
            <button type="button" onClick={resetSort} className="text-xs text-accent hover:underline">Reset sort</button>
          )}
          <button type="button" onClick={() => setShowAddDialog(true)}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90">+ New product</button>
          <button type="button" onClick={downloadTemplate}
            className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50">Download CSV</button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={bulkBusy}
            className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50 disabled:opacity-50">
            {bulkBusy ? "Uploading…" : "Upload CSV"}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          <div className="text-xs text-sand-500 pl-2 border-l border-sand-200">{visible.length} of {products.length}</div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}

      {bulkResult && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-lg px-3 py-2 flex items-start gap-3">
          <div className="flex-1">
            <div className="font-medium">
              Upload complete: {bulkResult.applied} updated
              {bulkResult.unchanged > 0 && `, ${bulkResult.unchanged} unchanged`}
              {bulkResult.skipped.length > 0 && `, ${bulkResult.skipped.length} skipped`}
            </div>
            {bulkResult.skipped.length > 0 && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer">Show skipped rows</summary>
                <ul className="mt-1 ml-4 list-disc">
                  {bulkResult.skipped.slice(0, 50).map((s, i) => (
                    <li key={i}><span className="font-mono">{s.sku}</span> — {s.reason}</li>
                  ))}
                  {bulkResult.skipped.length > 50 && <li>…and {bulkResult.skipped.length - 50} more.</li>}
                </ul>
              </details>
            )}
          </div>
          <button type="button" onClick={() => setBulkResult(null)} className="text-blue-700 hover:text-blue-900 text-xs">Dismiss</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 z-20 bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
            <tr>
              <Th sortable sortKey="sku" current={sortKey} dir={sortDir} onToggle={toggleSort}>
                <span className="inline-flex items-center">SKU<ColumnHint>The product code — unique across the catalog.</ColumnHint></span>
              </Th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <Th sortable sortKey="current_inventory" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">On hand<ColumnHint>Units in the warehouse right now. Click the blue number to edit. Also bumps automatically when you mark a PO line as received.</ColumnHint></span>
              </Th>
              <Th sortable sortKey="inbound" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Inbound<ColumnHint>Units already ordered but not yet received. Computed live as <span className="font-mono">SUM(qty_ordered − qty_received)</span> across every PO whose status is <em>Ordered</em> or <em>In transit</em>.</ColumnHint></span>
              </Th>
              <Th sortable sortKey="storage_capacity" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Capacity<ColumnHint>For glass: max units the warehouse can hold for this SKU (editable per SKU). For hardware: auto-derived target = <span className="font-mono">max(50, 3 × monthly × season × growth)</span> — three months of cover at the current month&apos;s sales rate, with a 50-unit floor for SKUs with no sales data. Hardware doesn&apos;t have a physical storage limit; this is the level we aim to maintain. Drives Perfect, Suggested, and Status.</ColumnHint></span>
              </Th>
              {showSalesDetail && (
                <>
                  <th className="text-right px-3 py-2 font-medium">
                    <span className="inline-flex items-center">GRS/mo<ColumnHint>Average monthly sales from the GRS channel.</ColumnHint></span>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <span className="inline-flex items-center">RF/mo<ColumnHint>Average monthly sales from the RF channel.</ColumnHint></span>
                  </th>
                </>
              )}
              <Th sortable sortKey="daily_sales" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center gap-1">
                  Monthly
                  <ColumnHint>Average units sold per month: <span className="font-mono">GRS + RF</span>.</ColumnHint>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setShowSalesDetail((v) => !v); }}
                    title={showSalesDetail ? "Hide GRS/RF" : "Show GRS/RF"}
                    className="text-sand-400 hover:text-accent text-[10px]">
                    {showSalesDetail ? "◀" : "▶"}
                  </button>
                </span>
              </Th>
              <Th sortable sortKey="days_of_stock_left" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Days (on hand)<ColumnHint>How many days you can keep selling using only what&apos;s in the warehouse: <span className="font-mono">on_hand / (monthly / 30)</span>. Doesn&apos;t account for inbound.</ColumnHint></span>
              </Th>
              <Th sortable sortKey="days_of_stock_with_inbound" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Days (w/ inbound)<ColumnHint>Days of coverage if every inbound PO landed today: <span className="font-mono">(on_hand + inbound) / (monthly / 30)</span>. Click 📈 for real per-ETA projection.</ColumnHint></span>
              </Th>
              <Th sortable sortKey="reorder_point" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                <span className="inline-flex items-center">Reorder pt<ColumnHint>The total-stock level (on hand + inbound) at which a new order should be placed: <span className="font-mono">target_at_arrival + lead_time_sales</span>. The target is the higher of the Expected-fill floor or the Target-at-arrival cover (% of a lead time of sales, see Settings), capped at capacity. Drops below this → status flips to Reorder.</ColumnHint></span>
              </Th>
              <th className="text-left px-3 py-2 font-medium">
                <span className="inline-flex items-center gap-1">Status<ColumnHint>
                  <span className="block"><strong>Reorder + Montreal transfer</strong> — on hand runs out before the next PO arrives AND total stock (on hand + inbound) is below the reorder point. Pull stock from the Montreal warehouse AND place a new main-supplier order.</span>
                  <span className="block mt-1"><strong>Montreal transfer</strong> — on hand runs out before the next PO arrives, but total stock is still above the reorder point. Pull stock from the Montreal warehouse to bridge the gap; no main-supplier reorder needed yet.</span>
                  <span className="block mt-1"><strong>Reorder now</strong> — total stock (on hand + inbound) is below the reorder point, i.e. ordering today would no longer land you at the target stock when the PO arrives (see Settings for the target cover and fill floor).</span>
                  <span className="block mt-1"><strong>OK</strong> — sufficient cover and inbound timing is safe.</span>
                  <span className="block mt-1"><strong>No sales data</strong> — monthly sales is 0.</span>
                </ColumnHint>
                <button type="button" onClick={(e) => { e.stopPropagation(); setShowPricingDetail((v) => !v); }}
                  title={showPricingDetail ? "Hide Value / Unit cost" : "Show Value / Unit cost"}
                  className="text-sand-400 hover:text-accent text-[10px]">
                  {showPricingDetail ? "◀" : "▶"}
                </button>
                </span>
              </th>
              {showPricingDetail && (
                <>
                  <Th sortable sortKey="inventory_value" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right">
                    <span className="inline-flex items-center">Value<ColumnHint>Dollar value of units on hand: <span className="font-mono">on_hand × unit_cost</span>.</ColumnHint></span>
                  </Th>
                  <th className="text-right px-3 py-2 font-medium">
                    <span className="inline-flex items-center justify-end">Unit cost<ColumnHint>Landed cost per unit in CAD. Snapshotted on each PO line.</ColumnHint></span>
                  </th>
                </>
              )}
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visible.map((p) => (
              <tr key={p.id} className={savingId === p.id ? "bg-amber-50/40" : ""}>
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2 text-sand-700">{p.name}</td>
                <EditableCell value={p.current_inventory}
                  onSave={(v) => saveField(p.id, "current_inventory", v)} saving={savingId === p.id} />
                <td className="px-3 py-2 text-right text-sand-500">{p.inbound > 0 ? fmtNum(p.inbound, 0) : "—"}</td>
                <td className="px-3 py-2 text-right text-sand-700">{fmtNum(p.storage_capacity, 0)}</td>
                {showSalesDetail && (
                  <>
                    <td className="px-3 py-2 text-right text-sand-700">{fmtNum(p.avg_monthly_sales_grs, 2)}</td>
                    <td className="px-3 py-2 text-right text-sand-700">{fmtNum(p.avg_monthly_sales_rf, 2)}</td>
                  </>
                )}
                <td className="px-3 py-2 text-right text-sand-500">{fmtNum(p.avg_monthly_sales_grs + p.avg_monthly_sales_rf, 1)}</td>
                <td className="px-3 py-2 text-right text-sand-700">{fmtNum(p.days_of_stock_left, 0)}</td>
                <td className={"px-3 py-2 text-right " + (p.inbound > 0 ? "text-sand-900 font-medium" : "text-sand-500")}>
                  {fmtNum(p.days_of_stock_with_inbound, 0)}
                </td>
                <td className="px-3 py-2 text-right text-sand-500">{fmtNum(p.reorder_point, 0)}</td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-2 py-0.5 rounded-md border text-[11px] " + (SOP_BADGE[p.sop_label] ?? "bg-sand-100 text-sand-600 border-sand-200")}>
                    {SOP_LABEL_DISPLAY[p.sop_label] ?? p.sop_label}
                  </span>
                </td>
                {showPricingDetail && (
                  <>
                    <td className="px-3 py-2 text-right text-sand-700">{formatCADWhole(p.inventory_value)}</td>
                    <td className="px-3 py-2 text-right text-sand-700">{fmtNum(p.unit_cost_landed, 2)}</td>
                  </>
                )}
                <td className="px-2 py-2 text-right">
                  <button type="button" onClick={() => setForecastSku(p.id)} title="Forecast"
                    className="text-sand-400 hover:text-accent text-sm">📈</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={10 + (showSalesDetail ? 2 : 0) + (showPricingDetail ? 2 : 0)} className="px-3 py-10 text-center text-sand-500">
                  No products match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-sand-500">
        Click the blue &ldquo;On hand&rdquo; number to edit. Inbound is computed live from open POs. Click 📈 for a per-SKU
        stockout forecast. For bulk edits, use Download CSV → edit in Excel → Upload CSV.
      </p>

      {forecastSku && (() => {
        const p = products.find((x) => x.id === forecastSku);
        if (!p) return null;
        return (
          <ForecastDrawer product={p} forecast={initialForecasts[forecastSku] ?? null}
            settings={settings}
            onClose={() => setForecastSku(null)} />
        );
      })()}

      {showAddDialog && (
        <AddProductDialog defaultCategory={category === "hardware" ? "hardware" : "glass"}
          onClose={() => setShowAddDialog(false)}
          onCreated={async () => { setShowAddDialog(false); await mutate(); router.refresh(); }} />
      )}

      {pendingRows && (
        <BulkUploadPreviewDialog changes={previewChanges} unchanged={previewUnchanged} skipped={previewSkipped}
          applying={bulkBusy} onCancel={cancelPendingUpload} onConfirm={applyPendingUpload} />
      )}

      <RecentActivityPanel />
    </div>
  );
}

function Th({ children, sortable, sortKey, current, dir, onToggle, align = "left" }: {
  children: React.ReactNode; sortable?: boolean; sortKey?: SortKey;
  current?: SortKey; dir?: "asc" | "desc"; onToggle?: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  if (!sortable || !sortKey || !onToggle) {
    return <th className={(align === "right" ? "text-right" : "text-left") + " px-3 py-2 font-medium"}>{children}</th>;
  }
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

function EditableCell({ value, digits = 0, saving, onSave }: {
  value: number; digits?: number; saving: boolean; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function startEdit() { setDraft(String(value)); setEditing(true); }
  function commit() { setEditing(false); if (draft !== String(value)) onSave(draft); }

  if (editing) {
    return (
      <td className="px-3 py-1 text-right">
        <input autoFocus type="number" step="any" value={draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            else if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 px-1.5 py-1 text-right rounded border border-accent focus:outline-none focus:ring-1 focus:ring-accent tabular-nums" />
      </td>
    );
  }
  return (
    <td className="px-3 py-2 text-right">
      <button type="button" disabled={saving} onClick={startEdit}
        className="text-accent hover:underline disabled:opacity-50 tabular-nums">{fmtNum(value, digits)}</button>
    </td>
  );
}
