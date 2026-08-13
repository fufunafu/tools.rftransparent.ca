"use client";

import { formatCADShort } from "@/lib/format";
import type { WarehouseOps } from "@/lib/ops-dashboard";
import type { TicketStats } from "@/lib/home-dashboard";
import { CardShell, Stat, num } from "@/components/admin/dashboard/widgets";

// Moved verbatim from OpsDashboard.tsx.

export function WarehouseCard({
  w,
  tickets,
}: {
  w: WarehouseOps;
  tickets: TicketStats | null;
}) {
  return (
    <CardShell label="Warehouse & logistics" note="today · 7d · 30d">
      <Stat
        label="Boxes built" value={num(w.today.boxesBuilt)}
        sub={`${num(w.last7.boxesBuilt)} · ${num(w.last30.boxesBuilt)}`}
        href="/warehouse"
        dataLabel="Boxes built" calc="Sum of boxes_built from the warehouse daily reports. A day with no report contributes nothing — never estimated."
        src="Supabase · warehouse_daily_reports"
      />
      <Stat
        label="Orders packed" value={num(w.today.ordersPacked)}
        sub={`${num(w.last7.ordersPacked)} · ${num(w.last30.ordersPacked)}`}
        href="/warehouse"
        dataLabel="Orders packed" calc="Sum of orders_packed from the warehouse daily reports."
        src="Supabase · warehouse_daily_reports"
      />
      <Stat
        label="Walk-in / pick-up" value={num(w.today.walkinPickup)}
        sub={`${num(w.last7.walkinPickup)} · ${num(w.last30.walkinPickup)}`}
        href="/warehouse"
        dataLabel="Walk-in / pick-up" calc="Sum of walkin_pickup from the warehouse daily reports."
        src="Supabase · warehouse_daily_reports"
      />
      <Stat
        label="Problem tickets" value={tickets ? num(tickets.open) : "—"}
        sub={tickets ? `open · ${tickets.overAlertAge} over ${tickets.alertDays}d` : "—"}
        href="/customer-service/problems"
        tone={tickets && tickets.overAlertAge > 0 ? "text-amber-600" : "text-slate-900"}
        dataLabel="Problem tickets" calc="Tickets with status in_progress, and how many are already past the 30-day alert age. Age measured from ticket_date, anchored at Toronto midnight."
        src="Supabase · problem_tickets"
      />
      <Stat
        label="Oldest ticket"
        value={tickets?.oldest ? `${tickets.oldest.ageDays} d` : "—"}
        sub={tickets?.oldest?.client_name ?? "none open"}
        href="/customer-service/problems"
        tone={tickets?.oldest && tickets.oldest.ageDays >= tickets.alertDays ? "text-red-600" : "text-slate-900"}
        dataLabel="Oldest ticket" calc="The longest-open in_progress ticket, measured from its ticket_date at Toronto midnight."
        src="Supabase · problem_tickets"
      />
      <Stat
        label="Unfulfilled" value={num(w.unfulfilled)}
        sub={
          w.oldestUnfulfilledDays !== null
            ? `oldest ${w.oldestUnfulfilledDays}d · ${w.avgFulfillmentHours ?? "—"}h avg`
            : "nothing waiting"
        }
        href="/warehouse"
        dataLabel="Unfulfilled" calc="Shopify orders with fulfillment_status:unfulfilled across every store, the age of the oldest, and the mean hours from order to first fulfillment over the last 30 days."
        src="Shopify Admin API · orders"
      />
      <Stat
        label="Inventory on hand" value={formatCADShort(w.inventoryValue)}
        sub={`${num(w.unitsOnHand)} units`}
        href="/warehouse/purchasing"
        dataLabel="Inventory on hand" calc="Summed inventory_value across products in the purchasing reorder view."
        src="Supabase · purchasing_reorder_view"
      />
      <Stat
        label="Inbound" value={formatCADShort(w.openPoValue)}
        sub={
          `${w.openPoCount} PO${w.openPoCount === 1 ? "" : "s"}` +
          (w.daysUntilNextArrival !== null ? ` · next lands ${w.daysUntilNextArrival}d` : "")
        }
        href="/warehouse/purchasing/orders"
        dataLabel="Inbound" calc="Value and count of purchase orders that are ordered or in transit, plus the soonest expected arrival across everything on order."
        src="Supabase · purchasing_orders"
      />
      <Stat
        label="To reorder — glass" value={num(w.reorderSkus)} amber
        sub={`${num(w.reorderUnits)} units · ${num(w.montrealTransfers)} transfers`}
        href="/warehouse/purchasing/reorder"
        dataLabel="To reorder — glass" calc="Glass SKUs whose reorder label is reorder or reorder_plus_montreal. Units is the summed suggested quantity."
        src="Supabase · purchasing_reorder_view"
      />
    </CardShell>
  );
}
