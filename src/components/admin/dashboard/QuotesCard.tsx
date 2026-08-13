"use client";

import { formatCADShort } from "@/lib/format";
import type { QuoteWindows } from "@/lib/ops-dashboard";
import { CardShell, Stat, num, pct } from "@/components/admin/dashboard/widgets";

// Quote volume for dashboards that don't carry the full customer-service
// card. Same definition as everywhere else: draft orders excluding OPEN.

export function QuotesCard({ quotes, note }: { quotes: QuoteWindows; note?: string }) {
  return (
    <CardShell
      label="Quotes"
      note={note}
      footer={
        <>
          <span className="text-slate-500">
            Quoted value 30d{" "}
            <span className="font-semibold text-slate-900 tabular-nums">
              {formatCADShort(quotes.quotedValue30)}
            </span>
          </span>
          <span className="text-slate-500">
            Conversion{" "}
            <span className="font-semibold text-slate-900 tabular-nums">{pct(quotes.conversion30)}</span>
          </span>
        </>
      }
    >
      {[
        ["yesterday", quotes.yesterday],
        ["7 days", quotes.last7],
        ["30 days", quotes.last30],
      ].map(([label, value]) => (
        <Stat
          key={`q-${label}`}
          label={`Quotes ${label as string}`}
          value={num(value as number)}
          href="/pipeline"
          dataLabel={`Quotes — ${label as string}`}
          calc="Draft orders created in the period, excluding status OPEN — an open draft is a work in progress, not a quote that went out. Same exclusion /api/kpi/metrics applies."
          src="Shopify Admin API · draftOrders"
        />
      ))}
    </CardShell>
  );
}
