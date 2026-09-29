"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { formatCADShort } from "@/lib/format";
import type { Performer, TopPerformers } from "@/lib/ops-dashboard";
import { delta, num } from "@/components/admin/dashboard/widgets";
import { getSalesPeriod, type SalesPeriod } from "@/lib/sales-periods";

// Moved verbatim from OpsDashboard.tsx. `sections` renders a subset of the
// three leaderboards; `locationSlug` keeps only one location's staff.
// Both default to the owner-dashboard behavior (everything, everyone).

export const RANKINGS = {
  sales: [
    { key: "sold", label: "Net sales $", format: formatCADShort },
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

export function PerformerLink({ person, children, ...props }: {
  person: Performer;
  children: ReactNode;
  className?: string;
  "aria-describedby"?: string;
  "data-label"?: string;
  "data-calc"?: string;
  "data-src"?: string;
}) {
  return person.hasEmployeeProfile === false
    ? <div {...props}>{children}</div>
    : <Link href={`/employees/${person.id}`} {...props}>{children}</Link>;
}

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

  // Show the full sales team, including new reps with no activity yet.
  const ranked = [...people]
    .sort((a, b) => (b.metrics[chosen.key] ?? 0) - (a.metrics[chosen.key] ?? 0))
    .slice(0, section === "sales" ? people.length : 3);

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
        <p className="px-4 py-3 text-[12px] text-slate-400">No activity in this period.</p>
      ) : (
        ranked.map((p, i) => {
          // `previous` covers the preceding equal-length period for the default metric.
          const d =
            chosen.key === options[0].key ? delta(p.metrics[chosen.key] ?? 0, p.previous) : null;
          return (
            <PerformerLink
              person={p}
              key={p.id}
              className="flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50 transition-colors"
              data-label={`${title}: ${chosen.label}`}
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
            </PerformerLink>
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
      "Net sales use successful payments less refunds, excluding tax and shipping proportionally, by payment date. Rob and Craig: RF name tags. Daniel: RF shipping province in Quebec, Nova Scotia, New Brunswick or PEI, with billing fallback for pickup orders and territory taking priority over tags. Aaron: RF orders and quotes in British Columbia created July 16, 2026 onward, except those tagged to Rob. Marie: BC Transparent orders and quotes tagged Marijac. Quotes use the same ownership rules and quote creation date. Delta compares the preceding period of the same length.",
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
      "Follow-ups logged in the last 30 days. Phone data has no per-agent attribution.",
    dataSrc: "Supabase · followup_logs",
  },
};

export function PerformersSection({
  p,
  sections = ["sales", "warehouse", "customerService"],
  locationSlug,
  salesPeriod = "30d",
  periodControl,
}: {
  p: TopPerformers;
  sections?: (keyof typeof RANKINGS)[];
  locationSlug?: string;
  salesPeriod?: SalesPeriod;
  periodControl?: ReactNode;
}) {
  const period = getSalesPeriod(salesPeriod);
  const byLocation = (people: Performer[]) =>
    locationSlug ? people.filter((person) => person.locationSlug === locationSlug) : people;
  const gridCols =
    sections.length === 1 ? "md:grid-cols-1" : sections.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 shrink-0">
          {sections.length === 1 && sections[0] === "sales" ? "Sales team" : "Top performers"} · {period.label.toLowerCase()}
        </span>
        <span className="flex-1 h-px bg-slate-200" />
        {periodControl}
      </div>
      <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
        {sections.map((section) => (
          <PerformerList
            key={section}
            title={LIST_META[section].title}
            people={byLocation(p[section])}
            section={section}
            dataCalc={`${LIST_META[section].dataCalc} Period: ${period.label.toLowerCase()}.`}
            dataSrc={LIST_META[section].dataSrc}
          />
        ))}
      </div>
      {sections.includes("sales") && (
        <div className="text-[11px] leading-relaxed text-slate-500 space-y-1">
          <p>Net sales are payments received less refunds, excluding tax and shipping, by payment date. Compared with the previous {period.days} days.</p>
          <p>Rob and Craig: tagged RF orders. Daniel: RF orders in Quebec, Nova Scotia, New Brunswick and PEI, including orders tagged to another rep. Aaron: RF orders and quotes in British Columbia created July 16, 2026 onward, except those tagged to Rob. Marie: BC Transparent orders and quotes tagged Marijac.</p>
        </div>
      )}
      {p.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <p className="font-semibold">Some totals may be incomplete.</p>
          <ul className="list-disc pl-4">
            {[...new Set(p.warnings)].map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
