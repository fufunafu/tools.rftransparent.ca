"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PurchasingPageHeader from "./PurchasingPageHeader";
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
  if (!s) return "-";
  return new Date(s).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export default function OrdersList({ initialOrders }: Props) {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<OrderType | "all">("all");
  const [search, setSearch] = useState("");

  const matching = useMemo(() => {
    return initialOrders.filter((o) => {
      if (typeFilter !== "all" && o.order_type !== typeFilter) return false;
      if (!`${o.po_number} ${o.supplier_name} ${o.notes ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [initialOrders, typeFilter, search]);
  const visible = useMemo(() => matching.filter(order => statusFilter === "all" || order.status === statusFilter), [matching, statusFilter]);

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
      <PurchasingPageHeader title="Purchase orders" description="Follow each order from draft to arrival. Open an order to update its ETA, edit lines, or receive stock." actions={<Link href="/warehouse/purchasing/reorder" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90">Plan a new order</Link>} />
      <div className="space-y-3 rounded-xl border border-sand-200 bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Search purchase orders" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO number, supplier, or notes" className="min-w-0 basis-64 flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm" />
          <select aria-label="Order type" value={typeFilter} onChange={e => setTypeFilter(e.target.value as OrderType | "all")} className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"><option value="all">All order types</option><option value="china">China orders</option><option value="montreal">Montreal transfers</option></select>
        </div>
        <div role="group" aria-label="Order status" className="flex flex-wrap gap-1.5 border-t border-sand-100 pt-3">
          <button type="button" aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}
            className={"rounded-md px-3 py-1.5 text-xs font-medium " + (statusFilter === "all" ? "bg-accent text-white" : "bg-sand-50 text-sand-600 hover:bg-sand-100")}>
            All ({matching.length})
          </button>
          {STATUS_ORDER.map((s) => {
            const count = matching.filter((o) => o.status === s).length;
            return (
              <button key={s} type="button" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}
                className={"rounded-md px-3 py-1.5 text-xs font-medium " + (statusFilter === s ? "bg-accent text-white" : "bg-sand-50 text-sand-600 hover:bg-sand-100")}>
                {STATUS_DISPLAY[s]} ({count})
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-sand-500"><span>{visible.length} of {initialOrders.length} orders shown</span><span>Value in this view <strong className="ml-1 font-semibold text-sand-900">{formatCADWhole(totals.value)}</strong></span></div>
      <div className="max-h-[65vh] overflow-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full min-w-[320px] text-sm md:min-w-[850px]">
          <caption className="sr-only">Purchase orders with status, expected arrival, and received quantities.</caption>
          <thead className="sticky top-0 z-20 bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="sticky left-0 z-30 bg-sand-50 text-left px-3 py-3 font-medium">Purchase order</th>
              <th className="hidden md:table-cell text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="hidden md:table-cell text-left px-3 py-2 font-medium">Supplier</th>
              <th className="hidden md:table-cell text-left px-3 py-2 font-medium">Order date</th>
              <th className="text-left px-3 py-2 font-medium">ETA</th>
              <th className="hidden md:table-cell text-right px-3 py-2 font-medium">Lines</th>
              <th className="hidden md:table-cell text-right px-3 py-2 font-medium">Qty</th>
              <th className="hidden md:table-cell text-right px-3 py-2 font-medium">Received</th>
              <th className="hidden md:table-cell text-right px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {visible.map((o) => (
              <tr key={o.id} className="hover:bg-sand-50">
                <td className="sticky left-0 z-10 bg-white px-3 py-3 font-mono text-xs">
                  <Link href={`/warehouse/purchasing/orders/${o.id}`} className="text-accent hover:underline">{o.po_number}</Link><span className="mt-1 block font-sans text-[10px] text-sand-500 md:hidden">{ORDER_TYPE_DISPLAY[o.order_type]}</span>
                </td>
                <td className="hidden md:table-cell px-3 py-2">
                  <span className={"inline-block px-2 py-0.5 rounded-md border text-[11px] " + TYPE_BADGE[o.order_type]}>
                    {ORDER_TYPE_DISPLAY[o.order_type]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-2 py-0.5 rounded-md border text-[11px] " + STATUS_BADGE[o.status]}>{STATUS_DISPLAY[o.status]}</span>
                </td>
                <td className="hidden md:table-cell px-3 py-2 text-sand-700">{o.supplier_name}</td>
                <td className="hidden md:table-cell px-3 py-2 text-sand-600">{fmtDate(o.order_date)}</td>
                <td className="px-3 py-2 text-sand-600">{fmtDate(o.eta_date)}</td>
                <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums">{o.line_count}</td>
                <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums">{o.total_qty_ordered.toLocaleString("en-CA")}</td>
                <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums text-sand-600">{o.percent_received}%</td>
                <td className="hidden md:table-cell px-3 py-2 text-right tabular-nums">{formatCADWhole(o.total_value)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-sand-500">No orders in this view.</td></tr>
            )}
          </tbody>
          {visible.length > 0 && (
            <tfoot className="hidden bg-sand-50 text-sand-700 font-medium md:table-footer-group">
              <tr>
                <td colSpan={6} className="px-3 py-2 text-right">Total ({visible.length})</td>
                <td className="px-3 py-2 text-right">-</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.qty.toLocaleString("en-CA")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.percent}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCADWhole(totals.value)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
