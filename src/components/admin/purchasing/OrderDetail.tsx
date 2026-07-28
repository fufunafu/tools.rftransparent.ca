"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  STATUS_DISPLAY, ORDER_TYPE_DISPLAY,
  type OrderStatus, type ProductWithMetrics, type PurchaseOrderDetail,
} from "@/lib/purchasing/types";
import RecentActivityPanel from "./RecentActivityPanel";
import { formatCAD } from "@/lib/format";

interface Props { initialOrder: PurchaseOrderDetail }

// Line items can be edited at any status. For Received POs, qty_ordered
// changes are harmless (records-only); adding new lines starts at
// qty_received = 0 (no inventory impact); deleting a line with
// qty_received > 0 triggers a BEFORE DELETE handler in the DB that
// subtracts that qty back from on-hand (see migration 044).
const EDITABLE_STATUSES: ReadonlyArray<OrderStatus> = [
  "draft",
  "ordered",
  "in_transit",
  "received",
  "cancelled",
];

const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["ordered", "cancelled"],
  ordered: ["in_transit", "received", "cancelled"],
  in_transit: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function OrderDetail({ initialOrder }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [etaDraft, setEtaDraft] = useState(order.eta_date ?? "");
  const [poDraft, setPoDraft] = useState(order.po_number);
  const [editingPo, setEditingPo] = useState(false);
  const [notesDraft, setNotesDraft] = useState(order.notes ?? "");

  const totals = useMemo(() => {
    let qty = 0, received = 0, value = 0;
    for (const it of order.items) {
      qty += it.qty_ordered; received += it.qty_received;
      value += it.qty_ordered * it.unit_cost_snapshot;
    }
    return { qty, received, value, percent: qty > 0 ? Math.round((received / qty) * 100) : 0 };
  }, [order.items]);

  const canEditLines = EDITABLE_STATUSES.includes(order.status);
  const canDelete = order.status === "draft" || order.status === "cancelled";
  const transitions = NEXT_STATUS[order.status];

  const { data: catalogData } = useSWR<{ products: ProductWithMetrics[] }>(
    canEditLines ? "/api/purchasing/products" : null,
  );
  const existingProductIds = useMemo(
    () => new Set(order.items.map((it) => it.product_id)), [order.items],
  );
  const availableProducts = useMemo(
    () => (catalogData?.products ?? []).filter((p) => !existingProductIds.has(p.id)),
    [catalogData, existingProductIds],
  );

  const [addSku, setAddSku] = useState("");
  const [addQty, setAddQty] = useState("");
  // When true, the "Add line item" row switches to a free-text description
  // (with optional unit cost) instead of a SKU dropdown.
  const [addCustom, setAddCustom] = useState(false);
  const [addCustomDesc, setAddCustomDesc] = useState("");
  const [addCustomCost, setAddCustomCost] = useState("");

  async function patchOrder(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/purchasing/orders/${order.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Update failed");
      }
      const data = await res.json();
      setOrder((o) => ({ ...o, ...data.order }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally { setBusy(false); }
  }

  async function refreshItems() {
    const res = await fetch(`/api/purchasing/orders/${order.id}`);
    if (res.ok) {
      const data = await res.json();
      setOrder(data.order);
    }
  }

  async function updateItem(itemId: string, payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/purchasing/orders/${order.id}/items`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Update failed");
      }
      await refreshItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally { setBusy(false); }
  }

  async function deleteItem(itemId: string) {
    if (!confirm("Remove this line from the order?")) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/purchasing/orders/${order.id}/items?item_id=${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      await refreshItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally { setBusy(false); }
  }

  async function deleteOrder() {
    if (!confirm(`Delete ${order.po_number}? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/purchasing/orders/${order.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      router.push("/warehouse/purchasing/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  function markAllReceived() {
    if (!confirm("Mark every line on this PO as fully received? This will bump inventory.")) return;
    Promise.all(
      order.items.filter((it) => it.qty_received < it.qty_ordered)
        .map((it) => updateItem(it.id, { qty_received: it.qty_ordered })),
    );
  }

  async function addLineItem() {
    const qty = parseFloat(addQty);
    if (!Number.isFinite(qty) || qty <= 0) return;

    const payload: Record<string, unknown> = { qty_ordered: qty };
    if (addCustom) {
      const desc = addCustomDesc.trim();
      if (!desc) return;
      payload.custom_description = desc;
      const cost = parseFloat(addCustomCost);
      payload.unit_cost_snapshot = Number.isFinite(cost) && cost >= 0 ? cost : 0;
    } else {
      if (!addSku) return;
      payload.product_id = addSku;
    }

    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/purchasing/orders/${order.id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add line item");
      }
      setAddSku(""); setAddQty("");
      setAddCustomDesc(""); setAddCustomCost("");
      await refreshItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add line item");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/warehouse/purchasing/orders" className="text-sm text-accent hover:underline">← Back to orders</Link>
        <div className="flex items-center gap-4">
          <a
            href={`/print/po/${order.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:underline"
            title="Opens a print-friendly version in a new tab. Use the browser's print dialog to save as PDF."
          >
            Print / PDF
          </a>
          {canDelete && (
            <button type="button" onClick={deleteOrder} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-50">Delete order</button>
          )}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-sand-200/60 p-5 space-y-4">
        <div className="flex flex-wrap items-baseline gap-3">
          {editingPo ? (
            <span className="flex items-baseline gap-2">
              <input
                type="text"
                value={poDraft}
                onChange={(e) => setPoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (poDraft.trim() && poDraft !== order.po_number) {
                      patchOrder({ po_number: poDraft.trim() }).then(() => setEditingPo(false));
                    } else {
                      setEditingPo(false);
                    }
                  } else if (e.key === "Escape") {
                    setPoDraft(order.po_number);
                    setEditingPo(false);
                  }
                }}
                className="text-lg font-semibold font-mono px-2 py-0.5 rounded border border-sand-300 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  if (poDraft.trim() && poDraft !== order.po_number) {
                    patchOrder({ po_number: poDraft.trim() }).then(() => setEditingPo(false));
                  } else {
                    setEditingPo(false);
                  }
                }}
                disabled={busy || !poDraft.trim()}
                className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setPoDraft(order.po_number);
                  setEditingPo(false);
                }}
                className="px-2 py-1 text-xs rounded border border-sand-300 text-sand-600 hover:bg-sand-50"
              >
                Cancel
              </button>
            </span>
          ) : (
            <h2
              className="text-lg font-semibold font-mono hover:bg-sand-50 rounded px-1 -mx-1 cursor-pointer"
              title="Click to rename"
              onClick={() => {
                setPoDraft(order.po_number);
                setEditingPo(true);
              }}
            >
              {order.po_number}
            </h2>
          )}
          <span className={
            "inline-block px-2 py-0.5 rounded-md border text-[11px] " +
            (order.order_type === "montreal"
              ? "bg-orange-50 text-orange-700 border-orange-200"
              : "bg-blue-50 text-blue-700 border-blue-200")
          }>
            {ORDER_TYPE_DISPLAY[order.order_type]}
          </span>
          <span className="text-sand-500 text-sm">{STATUS_DISPLAY[order.status]}</span>
          <span className="ml-auto text-xs text-sand-400">
            Created by {order.created_by_email ?? "—"} · {new Date(order.created_at).toLocaleDateString("en-CA")}
          </span>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-[11px] text-sand-400 uppercase tracking-wider">Order date</div>
            <div className="text-sand-700">{fmtDate(order.order_date)}</div>
          </div>
          <div>
            <div className="text-[11px] text-sand-400 uppercase tracking-wider">ETA</div>
            <div className="flex gap-1">
              <input type="date" value={etaDraft} onChange={(e) => setEtaDraft(e.target.value)} className="px-2 py-1 text-sm rounded border border-sand-300" />
              {etaDraft !== (order.eta_date ?? "") && (
                <button type="button" onClick={() => patchOrder({ eta_date: etaDraft || null })} disabled={busy}
                  className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">Save</button>
              )}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-sand-400 uppercase tracking-wider">Received date</div>
            <div className="text-sand-700">{fmtDate(order.received_date)}</div>
          </div>
          <div>
            <div className="text-[11px] text-sand-400 uppercase tracking-wider">Progress</div>
            <div className="text-sand-700 tabular-nums">
              {totals.received.toLocaleString("en-CA")} / {totals.qty.toLocaleString("en-CA")} ({totals.percent}%)
            </div>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-sand-400 uppercase tracking-wider mb-1">Notes</div>
          <div className="flex gap-2">
            <input type="text" value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="—"
              className="flex-1 px-2 py-1 text-sm rounded border border-sand-300" />
            {notesDraft !== (order.notes ?? "") && (
              <button type="button" onClick={() => patchOrder({ notes: notesDraft || null })} disabled={busy}
                className="px-3 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">Save</button>
            )}
          </div>
        </div>
        {transitions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-sand-100">
            <span className="text-xs text-sand-500">Move to:</span>
            {transitions.map((s) => (
              <button key={s} type="button" onClick={() => patchOrder({ status: s })} disabled={busy}
                className="px-3 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50 disabled:opacity-50">
                {STATUS_DISPLAY[s]}
              </button>
            ))}
            {(order.status === "ordered" || order.status === "in_transit") &&
              order.items.some((it) => it.qty_received < it.qty_ordered) && (
                <button type="button" onClick={markAllReceived} disabled={busy}
                  className="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Mark all received</button>
              )}
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 z-20 bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">SKU</th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-right px-3 py-2 font-medium">Qty ordered</th>
              <th className="text-right px-3 py-2 font-medium">Qty received</th>
              <th className="text-right px-3 py-2 font-medium">Unit cost</th>
              <th className="text-right px-3 py-2 font-medium">Line value</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {order.items.map((it) => {
              const fullyReceived = it.qty_received >= it.qty_ordered;
              return (
                <tr key={it.id}>
                  <td className="px-3 py-2 font-mono text-xs">{it.sku}</td>
                  <td className="px-3 py-2 text-sand-700">{it.name}</td>
                  <td className="px-3 py-2 text-right">
                    {canEditLines ? (
                      <NumberInput value={it.qty_ordered} onSave={(v) => updateItem(it.id, { qty_ordered: v })} disabled={busy} />
                    ) : it.qty_ordered.toLocaleString("en-CA")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {order.status === "ordered" || order.status === "in_transit" ? (
                      <NumberInput value={it.qty_received} max={it.qty_ordered}
                        onSave={(v) => updateItem(it.id, { qty_received: v })} disabled={busy} highlight={fullyReceived} />
                    ) : (
                      <span className={fullyReceived ? "text-green-700" : ""}>{it.qty_received.toLocaleString("en-CA")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-sand-500">{formatCAD(it.unit_cost_snapshot)}</td>
                  <td className="px-3 py-2 text-right">{formatCAD(it.qty_ordered * it.unit_cost_snapshot)}</td>
                  <td className="px-3 py-2 text-right">
                    {canEditLines && (
                      <button type="button" onClick={() => deleteItem(it.id)} disabled={busy}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50">Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {order.items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sand-500">This order has no line items.</td></tr>
            )}
            {canEditLines && (
              <tr className="bg-sand-50/50">
                <td colSpan={2} className="px-3 py-2">
                  {addCustom ? (
                    <input
                      type="text"
                      value={addCustomDesc}
                      onChange={(e) => setAddCustomDesc(e.target.value)}
                      placeholder="Describe the custom line (e.g. Rush charge, 1 box of bolts)"
                      className="w-full px-2 py-1 text-sm rounded border border-sand-300 bg-white"
                    />
                  ) : (
                    <select value={addSku} onChange={(e) => setAddSku(e.target.value)} className="w-full px-2 py-1 text-sm rounded border border-sand-300 bg-white">
                      <option value="">Add line item…</option>
                      {availableProducts.map((p) => (
                        <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <input type="number" step="any" min="0" value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder="Qty"
                    className="w-24 px-1.5 py-1 text-right rounded border border-sand-300 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
                </td>
                {/* Qty received — empty when adding a new line */}
                <td></td>
                <td className="px-3 py-2 text-right">
                  {addCustom && (
                    <input type="number" step="any" min="0" value={addCustomCost}
                      onChange={(e) => setAddCustomCost(e.target.value)} placeholder="Unit cost"
                      className="w-24 px-1.5 py-1 text-right rounded border border-sand-300 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
                  )}
                </td>
                {/* Line value — empty when adding a new line */}
                <td></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button type="button"
                    onClick={() => {
                      setAddCustom((v) => !v);
                      setAddSku(""); setAddCustomDesc(""); setAddCustomCost("");
                    }}
                    className="px-2 py-1 text-xs rounded border border-sand-300 text-sand-600 hover:bg-sand-100 mr-1">
                    {addCustom ? "Pick SKU" : "+ Custom"}
                  </button>
                  <button type="button" onClick={addLineItem}
                    disabled={busy || !addQty || (addCustom ? !addCustomDesc.trim() : !addSku)}
                    className="px-3 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed">Add</button>
                </td>
              </tr>
            )}
          </tbody>
          {order.items.length > 0 && (
            <tfoot className="bg-sand-50 text-sand-700 font-medium">
              <tr>
                <td colSpan={2} className="px-3 py-2 text-right">Total</td>
                <td className="px-3 py-2 text-right">{totals.qty.toLocaleString("en-CA")}</td>
                <td className="px-3 py-2 text-right">{totals.received.toLocaleString("en-CA")}</td>
                <td></td>
                <td className="px-3 py-2 text-right">{formatCAD(totals.value)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <RecentActivityPanel orderId={order.id} title="History for this PO" limit={50} />
    </div>
  );
}

function NumberInput({ value, onSave, disabled, max, highlight }: {
  value: number; onSave: (v: number) => void; disabled?: boolean; max?: number; highlight?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const synced = draft === String(value);
  return (
    <input type="number" step="any" min={0} max={max} disabled={disabled}
      value={synced ? String(value) : draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = parseFloat(draft);
        if (Number.isFinite(n) && n !== value) onSave(n);
        else setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") setDraft(String(value));
      }}
      className={"w-24 px-1.5 py-1 text-right rounded border focus:outline-none focus:ring-1 focus:ring-accent tabular-nums " +
        (highlight ? "border-green-400 bg-green-50" : "border-sand-300 focus:border-accent")} />
  );
}
