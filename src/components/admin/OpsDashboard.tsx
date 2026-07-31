"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { formatCADWhole, formatCADShort } from "@/lib/format";
import type { OpsDashboard as OpsData, StoreSales, Performer } from "@/lib/ops-dashboard";
import type { TicketStats } from "@/lib/home-dashboard";

// The operations dashboard. Server-fetched data comes in whole; this component
// owns only what genuinely needs the client — the provenance popover and the
// three ranking dropdowns, neither of which refetches anything.

// ─── Provenance popover ──────────────────────────────────────────────────────
// One delegated listener on the pane rather than a tooltip component per tile.
// Adding a metric later means adding the data-* attributes and nothing else.

interface Popover {
  label: string;
  calc: string;
  src: string;
  x: number;
  y: number;
}

const POPOVER_WIDTH = 264;

// ─── Formatting ──────────────────────────────────────────────────────────────

function pct(n: number | null | undefined, digits = 1): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

function num(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
}

function delta(current: number, previous: number | null): { text: string; tone: string } | null {
  if (previous === null || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change)) return null;
  return {
    text: `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`,
    tone: change >= 0 ? "text-emerald-600" : "text-red-600",
  };
}

/** Lower-is-better metrics invert: under target is good. */
function toneAgainstTarget(value: number | null, target: number, lowerIsBetter: boolean): string {
  if (value === null) return "text-slate-900";
  const good = lowerIsBetter ? value <= target : value >= target;
  const near = lowerIsBetter ? value <= target * 1.25 : value >= target * 0.9;
  return good ? "text-emerald-600" : near ? "text-amber-600" : "text-red-600";
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <span className="flex items-end gap-px h-[22px]" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={`w-[4px] rounded-[1px] ${i === values.length - 1 ? "bg-blue-500" : "bg-slate-200"}`}
          style={{ height: `${Math.max(2, (v / max) * 22)}px` }}
        />
      ))}
    </span>
  );
}

function Unavailable({ label, error }: { label: string; error: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-soft p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm text-slate-400">Unavailable</p>
      <p className="mt-0.5 text-xs text-slate-400 leading-snug">{error}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  tone = "text-slate-900",
  amber = false,
  dataLabel,
  calc,
  src,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: string;
  amber?: boolean;
  dataLabel: string;
  calc: string;
  src: string;
}) {
  const body = (
    <div
      className={`h-full px-4 py-2.5 ${amber ? "bg-amber-50" : "bg-white"}`}
      data-label={dataLabel}
      data-calc={calc}
      data-src={src}
    >
      <p className="text-[10.5px] text-slate-400">{label}</p>
      <p className={`text-[21px] font-semibold tabular-nums leading-tight ${amber ? "text-amber-700" : tone}`}>
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500 leading-tight">{sub}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full hover:bg-slate-50 transition-colors">
      {body}
    </Link>
  ) : (
    body
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function OpsDashboard({
  data,
  today,
  attention,
  ticketStats,
}: {
  data: OpsData;
  today: string;
  attention: string[];
  ticketStats: TicketStats | null;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);

  const onMouseOver = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-calc]");
    const pane = paneRef.current;
    if (!el || !pane) {
      setPopover(null);
      return;
    }
    const paneBox = pane.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    // Positioned inside the pane, never fixed, and clamped 8px from its right
    // edge so a right-hand tile's popover can't run off screen.
    const x = Math.min(box.left - paneBox.left, paneBox.width - POPOVER_WIDTH - 8);
    setPopover({
      label: el.dataset.label ?? "",
      calc: el.dataset.calc ?? "",
      src: el.dataset.src ?? "",
      x: Math.max(0, x),
      y: box.bottom - paneBox.top + 6,
    });
  }, []);

  const failures = [
    !data.sales.ok ? "sales" : null,
    !data.warehouse.ok ? "warehouse" : null,
    !data.customerService.ok ? "calls" : null,
    !data.performers.ok ? "performers" : null,
    !data.collection.ok ? "collection" : null,
  ].filter(Boolean) as string[];

  return (
    <div
      ref={paneRef}
      className="relative max-w-[1184px] mx-auto space-y-3"
      onMouseOver={onMouseOver}
      onMouseLeave={() => setPopover(null)}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Today</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            {today}
            {data.sales.ok && data.sales.value.cachedAt ? " · sales cached" : ""}
            {" · performers over 30 days"}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Recessive by design — these are exceptions, not a dashboard of alarms. */}
          {attention.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              {attention.map((a) => (
                <span key={a} className="flex items-center gap-1.5 text-[12px] text-slate-400">
                  <span className="w-1 h-1 rounded-full bg-slate-300" />
                  {a}
                </span>
              ))}
            </div>
          )}
          <a
            href="/wall"
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 inline-flex items-center gap-1.5 px-2.5 border border-slate-200 rounded-lg bg-white text-slate-600 text-xs hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[15px] h-[15px]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
            </svg>
            Wall display
          </a>
        </div>
      </div>

      {/* 1 — Sales by store */}
      {data.sales.ok ? (
        <SalesSection sales={data.sales.value.stores} />
      ) : (
        <Unavailable label="Sales by store" error={data.sales.error} />
      )}

      {/* 2 — Warehouse + Customer service */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {data.warehouse.ok ? (
          <WarehouseCard w={data.warehouse.value} tickets={ticketStats} />
        ) : (
          <Unavailable label="Warehouse & logistics" error={data.warehouse.error} />
        )}
        {data.customerService.ok ? (
          <CustomerServiceCard cs={data.customerService.value} />
        ) : (
          <Unavailable label="Customer service" error={data.customerService.error} />
        )}
      </div>

      {/* 3 — Top performers */}
      {data.performers.ok ? (
        <PerformersSection p={data.performers.value} />
      ) : (
        <Unavailable label="Top performers" error={data.performers.error} />
      )}

      {/* 4 — Collection */}
      {data.collection.ok ? (
        <CollectionCard c={data.collection.value} />
      ) : (
        <Unavailable label="Collection" error={data.collection.error} />
      )}

      {failures.length > 0 && (
        <p className="text-[11px] text-slate-400">
          Couldn&apos;t load: {failures.join(", ")}. Those numbers are missing, not zero.
        </p>
      )}

      {/* Provenance popover */}
      {popover && popover.calc && (
        <div
          className="absolute z-40 pointer-events-none bg-white border border-slate-200 rounded-lg shadow-soft p-2.5"
          style={{ width: POPOVER_WIDTH, left: popover.x, top: popover.y }}
        >
          <p className="text-[9px] font-semibold uppercase tracking-wider text-blue-600">{popover.label}</p>
          <p className="text-[11px] text-slate-600 mt-1 leading-snug">{popover.calc}</p>
          {popover.src && (
            <p className="text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100">{popover.src}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section 1 ───────────────────────────────────────────────────────────────

function SalesSection({ sales }: { sales: StoreSales[] }) {
  const totals = sales.reduce(
    (a, s) => ({
      today: a.today + s.todayRevenue,
      orders: a.orders + s.todayOrders,
      last7: a.last7 + s.last7,
      previous7: a.previous7 + s.previous7,
      last30: a.last30 + s.last30,
      previous30: a.previous30 + s.previous30,
      target: a.target + (s.target ?? 0),
    }),
    { today: 0, orders: 0, last7: 0, previous7: 0, last30: 0, previous30: 0, target: 0 }
  );

  const cols = "grid-cols-[minmax(140px,184px)_78px_1fr_84px_1fr_1fr_118px]";

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-x-auto">
      <div className={`min-w-[900px] grid ${cols} gap-3 px-[18px] py-2.5 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400`}>
        <span>Sales by store</span>
        <span>14d</span>
        <span className="text-right">Today</span>
        <span className="text-right">vs 7d</span>
        <span className="text-right">Last 7 days</span>
        <span className="text-right">Last 30 days</span>
        <span className="text-right">30d vs target</span>
      </div>

      {sales.map((s, i) => {
        const vs7 = delta(s.todayRevenue, s.priorAverageToHour);
        const d7 = delta(s.last7, s.previous7);
        const d30 = delta(s.last30, s.previous30);
        const targetPct = s.target ? (s.last30 / s.target) * 100 : null;
        return (
          <Link
            key={s.id}
            href="/sales"
            className={`min-w-[900px] grid ${cols} gap-3 px-[18px] py-2.5 items-center hover:bg-slate-50 transition-colors ${
              i === sales.length - 1 ? "border-b border-slate-200" : "border-b border-slate-100"
            }`}
            data-label={`${s.label} — sales`}
            data-calc="Net revenue: order subtotal after refunds, less shipping cost and export tariff metafields. Cancelled orders excluded. Bucketed by Toronto calendar day."
            data-src="Shopify Admin API · orders"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-[5px] px-[5px] py-[2px] shrink-0">
                {s.code}
              </span>
              <span className="text-[13px] font-semibold text-slate-900 truncate">{s.label}</span>
            </span>
            <Sparkline values={s.sparkline} />
            <span className="text-right">
              <span className="block text-[22px] font-semibold tabular-nums text-slate-900 leading-none">
                {formatCADWhole(s.todayRevenue)}
              </span>
              <span className="block text-[11px] text-slate-400 mt-0.5">
                {s.todayOrders} order{s.todayOrders === 1 ? "" : "s"}
              </span>
            </span>
            <span className={`text-right text-[13px] font-semibold ${vs7?.tone ?? "text-slate-400"}`}>
              {vs7?.text ?? "—"}
            </span>
            <span className="text-right">
              <span className="block text-[15px] font-semibold tabular-nums text-slate-900">
                {formatCADShort(s.last7)}
              </span>
              {d7 && <span className={`block text-[11px] ${d7.tone}`}>{d7.text}</span>}
            </span>
            <span className="text-right">
              <span className="block text-[15px] font-semibold tabular-nums text-slate-900">
                {formatCADShort(s.last30)}
              </span>
              {d30 && <span className={`block text-[11px] ${d30.tone}`}>{d30.text}</span>}
            </span>
            <span className="flex items-center justify-end gap-2">
              {targetPct === null ? (
                <span className="text-[11px] text-slate-300">no target</span>
              ) : (
                <>
                  <span className="w-11 h-1.5 bg-slate-200 rounded overflow-hidden">
                    <span
                      className={`block h-full rounded ${
                        targetPct >= 100 ? "bg-emerald-500" : targetPct >= 90 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(100, targetPct)}%` }}
                    />
                  </span>
                  <span className={`text-[13px] font-semibold ${toneAgainstTarget(targetPct, 100, false)}`}>
                    {targetPct.toFixed(0)}%
                  </span>
                </>
              )}
            </span>
          </Link>
        );
      })}

      <div className={`min-w-[900px] grid ${cols} gap-3 px-[18px] py-2.5 items-center bg-slate-50`}>
        <span className="text-[13px] font-semibold text-slate-900">All stores</span>
        <span />
        <span className="text-right text-[16px] font-semibold tabular-nums text-slate-900">
          {formatCADWhole(totals.today)}
        </span>
        <span />
        <span className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
          {formatCADShort(totals.last7)}
        </span>
        <span className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
          {formatCADShort(totals.last30)}
        </span>
        <span className="text-right text-[12px] font-semibold text-slate-500">
          {totals.target > 0 ? `${((totals.last30 / totals.target) * 100).toFixed(0)}%` : "—"}
        </span>
      </div>
    </section>
  );
}

// ─── Section 2 ───────────────────────────────────────────────────────────────

function CardShell({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-4 py-[7px] border-b border-slate-100">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
        {note && <span className="text-[11px] text-slate-400">{note}</span>}
      </div>
      <div className="grid grid-cols-3 gap-px bg-slate-100">{children}</div>
    </section>
  );
}

function WarehouseCard({
  w,
  tickets,
}: {
  w: import("@/lib/ops-dashboard").WarehouseOps;
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
        sub={tickets?.oldest ? `oldest ${tickets.oldest.ageDays}d` : "none open"}
        href="/customer-service/problems"
        tone={tickets?.oldest && tickets.oldest.ageDays >= tickets.alertDays ? "text-amber-600" : "text-slate-900"}
        dataLabel="Problem tickets" calc="Tickets with status in_progress. Age measured from ticket_date, anchored at Toronto midnight."
        src="Supabase · problem_tickets"
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
        sub="open purchase orders"
        href="/warehouse/purchasing/orders"
        dataLabel="Inbound" calc="Value of purchase orders that are open — ordered and not yet received."
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

function CustomerServiceCard({ cs }: { cs: import("@/lib/ops-dashboard").CustomerServiceOps }) {
  const windows = [
    { key: "yesterday", label: "yesterday", w: cs.yesterday },
    { key: "last7", label: "7 days", w: cs.last7 },
    { key: "last30", label: "30 days", w: cs.last30 },
  ];
  return (
    <CardShell label="Customer service" note="yesterday · 7d · 30d">
      {windows.map(({ key, label, w }) => (
        <Stat
          key={`miss-${key}`}
          label={`Miss rate ${label}`}
          value={pct(w.missRate)}
          sub={`${num(w.inbound)} inbound`}
          href="/customer-service/phones"
          tone={w.missRate === null ? "text-slate-400" : toneAgainstTarget(w.missRate, 10, true)}
          dataLabel={`Miss rate — ${label}`}
          calc="Unanswered weekday inbound calls ÷ weekday inbound calls. Weekends excluded. Shown as — when the window has no inbound calls, since that is not a 0% miss rate."
          src="Supabase · call_records (CIK + Grasshopper, deduplicated)"
        />
      ))}
      {windows.map(({ key, label, w }) => (
        <Stat
          key={`cb-${key}`}
          label={`Callback ${label}`}
          value={pct(w.callbackRate)}
          sub={w.avgResponseTime !== null ? `${num(w.avgResponseTime)}m avg` : "—"}
          href="/customer-service/phones"
          tone={w.callbackRate === null ? "text-slate-400" : toneAgainstTarget(w.callbackRate, 85, false)}
          dataLabel={`Callback — ${label}`}
          calc="Share of unanswered calls that got an outbound callback inside the 48-hour window. Average response is the mean time to that callback."
          src="Supabase · call_records (CIK + Grasshopper, deduplicated)"
        />
      ))}
    </CardShell>
  );
}

// ─── Section 3 ───────────────────────────────────────────────────────────────

const RANKINGS: Record<string, { key: string; label: string; format: (n: number) => string }[]> = {
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
};

function PerformerList({
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
          const d = delta(p.metrics[chosen.key] ?? 0, p.previous);
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

function PerformersSection({ p }: { p: import("@/lib/ops-dashboard").TopPerformers }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 shrink-0">
          Top performers · last 30 days
        </span>
        <span className="flex-1 h-px bg-slate-200" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PerformerList
          title="Sales" people={p.sales} section="sales"
          dataCalc="Orders and non-open draft orders in the last 30 days, attributed by Shopify tag (configured shopify_tags, else name-derived). Delta compares the previous 30 days."
          dataSrc="Shopify Admin API · orders + draftOrders"
        />
        <PerformerList
          title="Warehouse" people={p.warehouse} section="warehouse"
          dataCalc="Total units = boxes built + orders packed + walk-in, from the daily reports grouped by employee."
          dataSrc="Supabase · warehouse_daily_reports"
        />
        <PerformerList
          title="Customer service" people={p.customerService} section="customerService"
          dataCalc="Follow-ups logged in the last 30 days. Calls are deliberately absent — the phone data has no per-agent attribution."
          dataSrc="Supabase · followup_logs"
        />
      </div>
    </div>
  );
}

// ─── Section 4 ───────────────────────────────────────────────────────────────

function CollectionCard({ c }: { c: import("@/lib/ops-dashboard").CollectionOps }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-4 py-[7px] border-b border-slate-100">
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Collection</span>
          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-[5px] px-[5px] py-[2px]">RF only</span>
        </span>
        <span className="text-[11px] text-slate-400">unpaid Shopify orders</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-100">
        <Stat
          label="Over 30 days" value={formatCADShort(c.over30Amount)} sub={`${c.over30Count} orders`}
          href="/accounting/analysis" tone={c.over30Count > 0 ? "text-amber-600" : "text-slate-900"}
          dataLabel="Over 30 days" calc="Unpaid orders whose days pending is 30 or more, counted and summed."
          src="Shopify Admin API · unpaid orders (RF)"
        />
        <Stat
          label="Over 60 days" value={formatCADShort(c.over60Amount)}
          sub={`${c.over60Count} orders · ${c.over90Count} over 90d`}
          href="/accounting/analysis" tone={c.over60Count > 0 ? "text-red-600" : "text-slate-900"}
          dataLabel="Over 60 days" calc="Unpaid orders at 60+ days, with the 90+ subset called out separately."
          src="Shopify Admin API · unpaid orders (RF)"
        />
        <Stat
          label="To be collected" value={formatCADShort(c.totalUnpaid)} sub={`${c.unpaidCount} orders`}
          href="/accounting/analysis"
          dataLabel="To be collected" calc="Total outstanding across every unpaid RF order."
          src="Shopify Admin API · unpaid orders (RF)"
        />
        <Stat
          label="Oldest unpaid"
          value={<span className="text-[15px]">{c.oldest?.name ?? "—"}</span>}
          sub={c.oldest ? `${c.oldest.days} days · ${formatCADWhole(c.oldest.amount)} · ${c.oldest.order}` : "nothing outstanding"}
          href="/accounting/analysis"
          dataLabel="Oldest unpaid" calc="The single unpaid order with the highest days pending."
          src="Shopify Admin API · unpaid orders (RF)"
        />
      </div>
    </section>
  );
}
