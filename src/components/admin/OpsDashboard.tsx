"use client";

import { useState, useRef, useCallback } from "react";
import { formatCADWhole, formatCADShort } from "@/lib/format";
import type { OpsDashboard as OpsData } from "@/lib/ops-dashboard";
import type { TicketStats } from "@/lib/home-dashboard";
import { Stat, Unavailable, num } from "@/components/admin/dashboard/widgets";
import { DashboardSwitcher } from "@/components/admin/dashboard/DashboardSwitcher";
import { SalesSection } from "@/components/admin/dashboard/SalesSection";
import { PerformersSection } from "@/components/admin/dashboard/PerformersSection";
import { CustomerServiceCard } from "@/components/admin/dashboard/CustomerServiceCard";
import { WarehouseCard } from "@/components/admin/dashboard/WarehouseCard";

// The operations dashboard (Fuanne's view). Server-fetched data comes in
// whole; this component owns only what genuinely needs the client — the
// provenance popover and the ranking dropdowns, neither of which refetches
// anything. The section widgets live in ./dashboard/ and are shared with the
// role dashboards.

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

// ─── Main ────────────────────────────────────────────────────────────────────

export default function OpsDashboard({
  data,
  today,
  attention,
  ticketStats,
  wallHref,
}: {
  data: OpsData;
  today: string;
  attention: string[];
  ticketStats: TicketStats | null;
  /** /wall/[token], or null when no token has been issued. */
  wallHref: string | null;
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
          <DashboardSwitcher current="/" />
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
          {/* Only shown once a token exists — the board lives at /wall/[token]
              and bare /wall is a 404 by design. */}
          <a
            href={wallHref ?? "/settings/rates"}
            target={wallHref ? "_blank" : undefined}
            rel="noopener noreferrer"
            title={wallHref ? "Open the office wall board" : "No wall token issued yet"}
            className={`h-7 inline-flex items-center gap-1.5 px-2.5 border rounded-lg bg-white text-xs transition-colors ${
              wallHref
                ? "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                : "border-slate-200 text-slate-300 pointer-events-none"
            }`}
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

// ─── Collection (owner-only section) ─────────────────────────────────────────

function CollectionCard({ c }: { c: import("@/lib/ops-dashboard").CollectionOps }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-4 py-[7px] border-b border-slate-100">
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Collection</span>
          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded-[5px] px-[5px] py-[2px]">RF only</span>
        </span>
        <span className="text-[11px] text-slate-400">
          unpaid Shopify orders{c.dsoDays !== null ? ` · DSO ${c.dsoDays} days` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-100">
        <Stat
          label="Over 30 days" value={num(c.over30Count)} sub={`orders · ${formatCADShort(c.over30Amount)}`}
          href="/accounting/analysis" tone={c.over30Count > 0 ? "text-amber-600" : "text-slate-900"}
          dataLabel="Over 30 days" calc="Unpaid orders whose days pending is 30 or more, counted and summed."
          src="Shopify Admin API · unpaid orders (RF)"
        />
        <Stat
          label="Over 60 days" value={num(c.over60Count)}
          sub={`orders · ${formatCADShort(c.over60Amount)} · ${c.over90Count} over 90d`}
          href="/accounting/analysis" tone={c.over60Count > 0 ? "text-red-600" : "text-slate-900"}
          dataLabel="Over 60 days" calc="Unpaid orders at 60+ days, with the 90+ subset called out separately."
          src="Shopify Admin API · unpaid orders (RF)"
        />
        <Stat
          label="Total outstanding" value={formatCADShort(c.totalUnpaid)} sub={`${c.unpaidCount} orders`}
          href="/accounting/analysis"
          dataLabel="Total outstanding" calc="Every unpaid RF order summed, including fresh invoices still inside normal terms. The wall board's 'To collect' shows only the 60-day-plus slice — the part needing collection effort."
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
