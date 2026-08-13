"use client";

import Link from "next/link";
import { formatCADWhole, formatCADShort } from "@/lib/format";
import type { StoreSales } from "@/lib/ops-dashboard";
import { Sparkline, delta, toneAgainstTarget } from "@/components/admin/dashboard/widgets";

// Moved verbatim from OpsDashboard.tsx. `storeIds` scopes the table for the
// store-manager dashboards; undefined keeps the owner view unchanged.

export function SalesSection({
  sales,
  storeIds,
  totalLabel = "All stores",
}: {
  sales: StoreSales[];
  storeIds?: string[];
  totalLabel?: string;
}) {
  if (storeIds) sales = sales.filter((s) => storeIds.includes(s.id));
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
        <span className="text-[13px] font-semibold text-slate-900">{totalLabel}</span>
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
