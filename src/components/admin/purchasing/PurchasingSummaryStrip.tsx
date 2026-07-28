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
    { label: "Total inventory value", value: formatCADWhole(summary.total_inventory_value) },
    { label: "Units on hand", value: formatNumber(summary.units_on_hand) },
    { label: "Open PO value", value: formatCADWhole(summary.open_po_value) },
    { label: "Ordered this month", value: formatCADWhole(summary.month_order_value) },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-sand-200/60 p-4">
          <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">
            {c.label}
          </div>
          <div className="text-2xl font-semibold text-sand-900 mt-1 tabular-nums">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
