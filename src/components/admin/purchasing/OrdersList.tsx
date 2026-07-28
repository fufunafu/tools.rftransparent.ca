"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCADWhole } from "@/lib/format";
import {
  STATUS_DISPLAY,
  STATUS_ORDER,
  ORDER_TYPE_DISPLAY,
  type OrderStatus,
  type OrderType,
  type PurchaseOrderWithRollup,
} from "@/lib/purchasing/types";

interface Props { initialOrders: PurchaseOrderWithRollup[] }

const STATUS_BADGE: Record<OrderStatus, string> = {
  draft: "bg-sand-100 text-sand-600 border-sand-200",
  ordered: "bg-blue-50 text-blue-700 border-blue-200",
  in_transit: "bg-amber-50 text-amber-700 border-amber-200",
  received: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

const TYPE_BADGE: Record<OrderType, string> = {
  china: "bg-blue-50 text-blue-700 border-blue-200",
  montreal: "bg-orange-50 text-orange-700 border-orange-200",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function OrdersList({ initialOrders }: Props) {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<OrderType | "all">("all");

  const visible = useMemo(() => {
    return initialOrders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (typeFilter !== "all" && o.order_type !== typeFilter) return false;
      return true;
    });
  }, [initialOrders, statusFilter, typeFilter]);

  const totals = useMemo(() => {
    let qty = 0, received = 0, value = 0;
    for (const o of visible) {
      qty += o.total_qty_ordered;
      received += o.total_qty_received;
      value += o.total_value;
    }
    return { qty, received, value, percent: qty > 0 ? Math.round((received / qty) * 100) : 0 };
  }, [visible]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden flex-wrap">
          <button onClick={() => setStatusFilter("all")}
            className={"px-3 py-1.5 text-sm " + (statusFilter === "all" ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>
            All ({initialOrders.length})
          </button>
          {STATUS_ORDER.map((s) => {
            const count = initialOrders.filter((o) => o.status === s).length;
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={"px-3 py-1.5 text-sm " + (statusFilter === s ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>
                {STATUS_DISPLAY[s]} ({count})
              </button>
            );
          })}
        </div>
        <span className="text-xs text-sand-400 mx-1">·</span>
        <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden flex-wrap">
          <button onClick={() => setTypeFilter("all")}
            className={"px-3 py-1.5 text-sm " + (typeFilter === "all" ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>
            All types
          </button>
          {(["china", "montreal"] as const).map((t) => {
            const count = initialOrders.filter((o) => o.order_type === t).length;
            return (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={"px-3 py-1.5 text-sm " + (typeFilter === t ? "bg-accent text-white" : "bg-white text-sand-700 hover:bg-sand-50")}>
                {ORDER_TYPE_DISPLAY[t]} ({count})
              </button>
            );
          })}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">PO #</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Supplier</th>
              <th className="text-left px-3 py-2 font-medium">Order date</th>
              <th className="text-left px-3 py-2 font-medium">ETA</th>
              <th className="text-right px-3 py-2 font-medium">Lines</th>
              <th className="text-right px-3 py-2 font-medium">Qty</th>
              <th className="text-right px-3 py-2 font-medium">Received</th>
              <th className="text-right px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visible.map((o) => (
              <tr key={o.id} className="hover:bg-sand-50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/warehouse/purchasing/orders/${o.id}`} className="text-accent hover:underline">{o.po_number}</Link>
                </td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-2 py-0.5 rounded-md border text-[11px] " + TYPE_BADGE[o.order_type]}>
                    {ORDER_TYPE_DISPLAY[o.order_type]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-2 py-0.5 rounded-md border text-[11px] " + STATUS_BADGE[o.status]}>{STATUS_DISPLAY[o.status]}</span>
                </td>
                <td className="px-3 py-2 text-sand-700">{o.supplier_name}</td>
                <td className="px-3 py-2 text-sand-600">{fmtDate(o.order_date)}</td>
                <td className="px-3 py-2 text-sand-600">{fmtDate(o.eta_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.line_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.total_qty_ordered.toLocaleString("en-CA")}</td>
                <td className="px-3 py-2 text-right tabular-nums text-sand-600">{o.percent_received}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCADWhole(o.total_value)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-sand-500">No orders in this view.</td></tr>
            )}
          </tbody>
          {visible.length > 0 && (
            <tfoot className="bg-sand-50 text-sand-700 font-medium">
              <tr>
                <td colSpan={6} className="px-3 py-2 text-right">Total ({visible.length})</td>
                <td className="px-3 py-2 text-right">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.qty.toLocaleString("en-CA")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.percent}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCADWhole(totals.value)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-sand-500">
        Create a new order from the{" "}
        <Link href="/warehouse/purchasing/reorder" className="text-accent hover:underline">Reorder</Link> page.
      </p>
    </div>
  );
}
