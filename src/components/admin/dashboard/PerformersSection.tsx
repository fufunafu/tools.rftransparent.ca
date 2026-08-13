"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCADShort } from "@/lib/format";
import type { Performer, TopPerformers } from "@/lib/ops-dashboard";
import { delta, num } from "@/components/admin/dashboard/widgets";

// Moved verbatim from OpsDashboard.tsx. `sections` renders a subset of the
// three leaderboards; `locationSlug` keeps only one location's staff.
// Both default to the owner-dashboard behavior (everything, everyone).

export const RANKINGS = {
  sales: [
    { key: "sold", label: "Sold $", format: formatCADShort },
    { key: "quoted", label: "Quoted $", format: formatCADShort },
    { key: "conversion", label: "Conversion", format: (n) => `${n.toFixed(1)}%` },
  ],
  warehouse: [
    { key: "units", label: "Total units", format: num },
    { key: "boxes", label: "Boxes built", format: num },
    { key: "packed", label: "Orders packed", format: num },
    { key: "walkin", label: "Walk-in", format: num },
  ],
  customerService: [{ key: "followups", label: "Follow-ups", format: num }],
} satisfies Record<string, { key: string; label: string; format: (n: number) => string }[]>;

export function PerformerList({
  title,
  people,
  section,
  dataCalc,
  dataSrc,
}: {
  title: string;
  people: Performer[];
  section: keyof typeof RANKINGS;
  dataCalc: string;
  dataSrc: string;
}) {
  const options = RANKINGS[section];
  const [metric, setMetric] = useState(options[0].key);
  const chosen = options.find((o) => o.key === metric) ?? options[0];

  // Client-side re-sort of an already-fetched list — no refetch.
  const ranked = [...people]
    .sort((a, b) => (b.metrics[chosen.key] ?? 0) - (a.metrics[chosen.key] ?? 0))
    .slice(0, 3);

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-[7px] border-b border-slate-100">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 truncate">
          {title}
        </span>
        {options.length > 1 && (
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            aria-label={`Rank ${title} by`}
            className="h-6 shrink-0 text-[11px] border border-slate-200 bg-slate-50 rounded-md px-1"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {ranked.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-slate-400">No activity in the last 30 days.</p>
      ) : (
        ranked.map((p, i) => {
          // `previous` is the prior-30-day value of the DEFAULT metric only,
          // so a delta is honest only when that's what's being ranked —
          // comparing quoted-$ against last month's sold-$ isn't a trend.
          const d =
            chosen.key === options[0].key ? delta(p.metrics[chosen.key] ?? 0, p.previous) : null;
          return (
            <Link
              key={p.id}
              href={`/employees/${p.id}`}
              className="flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50 transition-colors"
              data-label={`${title} — ${chosen.label}`}
              data-calc={dataCalc}
              data-src={dataSrc}
            >
              <span className="w-[18px] h-[18px] shrink-0 rounded-[5px] bg-slate-100 text-slate-500 text-[10.5px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-slate-900 truncate">{p.name}</span>
                <span className="block text-[10.5px] text-slate-400 truncate">{p.meta}</span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-[15px] font-semibold tabular-nums text-slate-900">
                  {chosen.format(p.metrics[chosen.key] ?? 0)}
                </span>
                {d && <span className={`block text-[10.5px] ${d.tone}`}>{d.text}</span>}
              </span>
            </Link>
          );
        })
      )}
    </section>
  );
}

const LIST_META: Record<keyof typeof RANKINGS, { title: string; dataCalc: string; dataSrc: string }> = {
  sales: {
    title: "Sales",
    dataCalc:
      "Orders and non-open draft orders in the last 30 days, attributed by Shopify tag (configured shopify_tags, else name-derived). Delta compares the previous 30 days.",
    dataSrc: "Shopify Admin API · orders + draftOrders",
  },
  warehouse: {
    title: "Warehouse",
    dataCalc: "Total units = boxes built + orders packed + walk-in, from the daily reports grouped by employee.",
    dataSrc: "Supabase · warehouse_daily_reports",
  },
  customerService: {
    title: "Customer service",
    dataCalc:
      "Follow-ups logged in the last 30 days. Calls are deliberately absent — the phone data has no per-agent attribution.",
    dataSrc: "Supabase · followup_logs",
  },
};

export function PerformersSection({
  p,
  sections = ["sales", "warehouse", "customerService"],
  locationSlug,
}: {
  p: TopPerformers;
  sections?: (keyof typeof RANKINGS)[];
  locationSlug?: string;
}) {
  const byLocation = (people: Performer[]) =>
    locationSlug ? people.filter((person) => person.locationSlug === locationSlug) : people;
  const gridCols =
    sections.length === 1 ? "md:grid-cols-1" : sections.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 shrink-0">
          Top performers · last 30 days
        </span>
        <span className="flex-1 h-px bg-slate-200" />
      </div>
      <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
        {sections.map((section) => (
          <PerformerList
            key={section}
            title={LIST_META[section].title}
            people={byLocation(p[section])}
            section={section}
            dataCalc={LIST_META[section].dataCalc}
            dataSrc={LIST_META[section].dataSrc}
          />
        ))}
      </div>
    </div>
  );
}
