import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated, isManagementUser } from "@/lib/admin-auth";
import { getOrderDetail } from "@/lib/purchasing/queries";
import PrintTrigger from "@/components/admin/purchasing/PrintTrigger";
import { formatCAD } from "@/lib/format";

export const metadata: Metadata = {
  title: "Purchase order",
  robots: { index: false, follow: false },
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function PrintPOPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");
  if (!(await isManagementUser())) redirect("/warehouse");

  const { id } = await params;
  const order = await getOrderDetail(id);
  if (!order) notFound();

  const isMontreal = order.order_type === "montreal";
  const documentTitle = isMontreal ? "TRANSFER ORDER" : "PURCHASE ORDER";
  // Both order types ship into the Toronto warehouse. Source differs:
  // Montreal transfers come from the Montreal warehouse, China orders
  // come from the named supplier.
  const fromName = isMontreal ? "Montreal warehouse" : order.supplier_name;
  const shipToName = "RF Transparent — Toronto warehouse";
  const shipToAddress = "67 Westmore Drive, Toronto, ON";

  const totalQty = order.items.reduce((s, it) => s + it.qty_ordered, 0);
  const totalValue = order.items.reduce(
    (s, it) => s + it.qty_ordered * it.unit_cost_snapshot,
    0,
  );

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 14mm 12mm;
        }
      `}</style>
      <PrintTrigger />
      <div className="max-w-[760px] mx-auto px-8 py-10 print:px-0 print:py-0">
        {/* Top header */}
        <div className="flex items-start justify-between pb-4 border-b-2 border-slate-900">
          <div>
            <div className="text-2xl font-bold tracking-tight">
              RF Transparent
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              Internal purchasing document
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tracking-wide">
              {documentTitle}
            </div>
            <div className="font-mono text-sm mt-0.5">{order.po_number}</div>
          </div>
        </div>

        {/* From / Ship to */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mt-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              From
            </div>
            <div className="font-medium">{fromName}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              Ship to
            </div>
            <div className="font-medium">{shipToName}</div>
            <div className="text-slate-600">{shipToAddress}</div>
          </div>
        </div>

        {/* Status / dates */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mt-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              Status
            </div>
            <div className="capitalize">{order.status.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              Order date
            </div>
            {/* order_date is only set when the PO transitions Draft → Ordered.
                Fall back to created_at so a Draft printout still carries a
                meaningful date. */}
            <div>{fmtDate(order.order_date ?? order.created_at)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              Expected arrival
            </div>
            <div>{fmtDate(order.eta_date)}</div>
          </div>
          {order.received_date && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                Received date
              </div>
              <div>{fmtDate(order.received_date)}</div>
            </div>
          )}
        </div>

        {/* Responsible person — promoted to its own block so it's obvious
            who to follow up with about this shipment. */}
        <div className="mt-6 border border-slate-300 rounded p-3 text-sm">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Responsible for this order
          </div>
          <div className="font-medium mt-0.5">
            {order.created_by_email ?? "—"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Contact this person with questions, ETA updates, or receiving
            issues.
          </div>
        </div>

        {/* Line items */}
        <table className="w-full mt-8 text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th className="py-2 pr-3 font-semibold">SKU</th>
              <th className="py-2 pr-3 font-semibold">Description</th>
              <th className="py-2 pr-3 font-semibold text-right">Qty</th>
              {!isMontreal && (
                <>
                  <th className="py-2 pr-3 font-semibold text-right">
                    Unit cost
                  </th>
                  <th className="py-2 font-semibold text-right">Line total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.id} className="border-b border-slate-200 align-top">
                <td className="py-2 pr-3 font-mono text-xs">{it.sku}</td>
                <td className="py-2 pr-3">{it.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {it.qty_ordered.toLocaleString("en-CA")}
                </td>
                {!isMontreal && (
                  <>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCAD(it.unit_cost_snapshot)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCAD(it.qty_ordered * it.unit_cost_snapshot)}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {order.items.length === 0 && (
              <tr>
                <td
                  colSpan={isMontreal ? 3 : 5}
                  className="py-6 text-center text-slate-500"
                >
                  No line items.
                </td>
              </tr>
            )}
            {/* Total row inside tbody (not tfoot) — tfoot is repeated by
                browsers on every print page; tbody rows render once. */}
            {order.items.length > 0 && (
              <tr className="border-t-2 border-slate-900 font-semibold">
                <td className="py-3 pr-3" colSpan={2}>
                  Total ({order.items.length}{" "}
                  {order.items.length === 1 ? "line" : "lines"})
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {totalQty.toLocaleString("en-CA")}
                </td>
                {!isMontreal && (
                  <>
                    <td className="py-3 pr-3"></td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCAD(totalValue)}
                    </td>
                  </>
                )}
              </tr>
            )}
          </tbody>
        </table>

        {/* Notes */}
        {order.notes && (
          <div className="mt-8 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">
              Notes
            </div>
            <div className="whitespace-pre-wrap">{order.notes}</div>
          </div>
        )}

        {/* Signature block */}
        <div className="grid grid-cols-2 gap-8 mt-16 text-xs text-slate-600">
          <div>
            <div className="border-t border-slate-400 pt-1.5">
              Prepared by — signature & date
            </div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-1.5">
              {isMontreal ? "Received at destination" : "Supplier acknowledgment"}{" "}
              — signature & date
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 text-[10px] text-slate-400 text-center">
          Generated on {new Date().toLocaleString("en-CA")} from
          tools.rftransparent.ca
        </div>
      </div>
    </div>
  );
}
