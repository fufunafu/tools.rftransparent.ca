import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated, isManagementUser } from "@/lib/admin-auth";
import { getOrderDetail } from "@/lib/purchasing/queries";
import PrintTrigger from "@/components/admin/purchasing/PrintTrigger";

export const metadata: Metadata = {
  title: "Purchase order",
  robots: { index: false, follow: false },
};

function fmtCAD(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(n);
}
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
  const partyLabel = isMontreal ? "Transfer to" : "Supplier";

  const totalQty = order.items.reduce((s, it) => s + it.qty_ordered, 0);
  const totalValue = order.items.reduce(
    (s, it) => s + it.qty_ordered * it.unit_cost_snapshot,
    0,
  );

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <PrintTrigger />
      <div className="max-w-[820px] mx-auto px-8 py-10 print:px-0 print:py-4">
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

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mt-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              {partyLabel}
            </div>
            <div className="font-medium">{order.supplier_name}</div>
          </div>
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
            <div>{fmtDate(order.order_date)}</div>
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
          {order.created_by_email && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                Prepared by
              </div>
              <div>{order.created_by_email}</div>
            </div>
          )}
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
                      {fmtCAD(it.unit_cost_snapshot)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtCAD(it.qty_ordered * it.unit_cost_snapshot)}
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
          </tbody>
          {order.items.length > 0 && (
            <tfoot>
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
                      {fmtCAD(totalValue)}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          )}
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
