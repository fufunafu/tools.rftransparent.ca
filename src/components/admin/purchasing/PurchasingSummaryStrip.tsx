import type { PurchasingSummary } from "@/lib/purchasing/types";
import { formatCADWhole } from "@/lib/format";

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-CA").format(n);
}

interface Props {
  summary: PurchasingSummary;
}

export default function PurchasingSummaryStrip({ summary }: Props) {
  const cards = [
    { label: "Inventory value", value: formatCADWhole(summary.total_inventory_value) },
    { label: "Units on hand", value: formatNumber(summary.units_on_hand) },
    { label: "Open purchase orders", value: formatCADWhole(summary.open_po_value) },
    { label: "Ordered this month", value: formatCADWhole(summary.month_order_value) },
  ];

  const metrics = (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-sand-200 bg-sand-200 md:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white px-4 py-3">
          <div className="text-xs font-medium text-sand-500">
            {c.label}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-sand-900">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
  return <>
    <div className="hidden sm:block">{metrics}</div>
    <details className="rounded-lg border border-sand-200 bg-white p-3 sm:hidden">
      <summary className="cursor-pointer text-xs font-medium text-sand-600">Workspace totals <span className="ml-2 font-semibold text-sand-900">{formatCADWhole(summary.total_inventory_value)} inventory</span></summary>
      <div className="mt-3">{metrics}</div>
    </details>
  </>;
}
