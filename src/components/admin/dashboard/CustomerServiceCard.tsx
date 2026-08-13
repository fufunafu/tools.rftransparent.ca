"use client";

import { formatCADShort } from "@/lib/format";
import type { CustomerServiceOps } from "@/lib/ops-dashboard";
import { CardShell, Stat, num, pct, toneAgainstTarget } from "@/components/admin/dashboard/widgets";

// Moved verbatim from OpsDashboard.tsx. `note` is overridable so a scoped
// store dashboard can say which store's lines it covers.

export function CustomerServiceCard({
  cs,
  note = "all stores · weekdays · 48h window",
}: {
  cs: CustomerServiceOps;
  note?: string;
}) {
  const windows = [
    { key: "yesterday", label: cs.yesterdayLabel.toLowerCase(), w: cs.yesterday },
    { key: "last7", label: "7 days", w: cs.last7 },
    { key: "last30", label: "30 days", w: cs.last30 },
  ];
  return (
    <CardShell
      label="Customer service"
      note={note}
      footer={
        <>
          <span className="text-slate-500">
            Quoted value 30d{" "}
            <span className="font-semibold text-slate-900 tabular-nums">
              {formatCADShort(cs.quotes.quotedValue30)}
            </span>
          </span>
          <span className="text-slate-500">
            Conversion{" "}
            <span className="font-semibold text-slate-900 tabular-nums">
              {pct(cs.quotes.conversion30)}
            </span>
          </span>
        </>
      }
    >
      {windows.map(({ key, label, w }) => (
        <Stat
          key={`miss-${key}`}
          label={`Miss rate ${label}`}
          value={pct(w.missRate)}
          sub={`${num(w.inbound)} inbound`}
          href="/customer-service/phones"
          tone={w.missRate === null ? "text-slate-400" : toneAgainstTarget(w.missRate, 10, true)}
          dataLabel={`Miss rate — ${label}`}
          calc="Unanswered weekday inbound calls ÷ weekday inbound calls, across ALL stores combined — the Phones page shows one store at a time, so its numbers differ. Weekends excluded; — means no inbound calls, which is not a 0% miss rate."
          src="Supabase · call_records (per-store deduplicated, then merged)"
        />
      ))}
      {windows.map(({ key, label, w }) => (
        <Stat
          key={`cb-${key}`}
          label={`Callback ${label}`}
          value={pct(w.callbackRate)}
          sub={w.avgResponseTime !== null ? `avg response ${num(w.avgResponseTime)} min` : "—"}
          href="/customer-service/phones"
          tone={w.callbackRate === null ? "text-slate-400" : toneAgainstTarget(w.callbackRate, 85, false)}
          dataLabel={`Callback — ${label}`}
          calc="Share of unanswered calls that got an outbound callback inside the 48-hour window, across ALL stores combined. Average response is the mean time to that callback."
          src="Supabase · call_records (per-store deduplicated, then merged)"
        />
      ))}
      {[
        ["yesterday", cs.quotes.yesterday],
        ["7 days", cs.quotes.last7],
        ["30 days", cs.quotes.last30],
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
