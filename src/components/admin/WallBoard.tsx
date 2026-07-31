"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCADWhole, formatCADShort } from "@/lib/format";
import type { OpsDashboard as OpsData } from "@/lib/ops-dashboard";
import type { TicketStats } from "@/lib/home-dashboard";

// The office wall board. Glanceable, not a show: no animation, no carousel,
// nothing clickable, and nothing smaller than 14px. It must fit 1080px without
// scrolling, so every row is sized rather than left to grow.

const REFRESH_MS = 90_000;

function pct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

function num(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
}

function deltaText(current: number, previous: number | null): { text: string; tone: string } | null {
  if (previous === null || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change)) return null;
  return {
    text: `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}%`,
    tone: change >= 0 ? "text-emerald-400" : "text-red-400",
  };
}

function Card({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div
      className={`bg-slate-800 rounded-2xl p-5 border ${
        warn ? "border-amber-400/40" : "border-white/[0.08]"
      }`}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] font-medium text-slate-400">{children}</p>;
}

export default function WallBoard({
  data,
  today,
  ticketStats,
  generatedAt,
}: {
  data: OpsData;
  today: string;
  ticketStats: TicketStats | null;
  generatedAt: string;
}) {
  const router = useRouter();
  const [age, setAge] = useState("just now");

  // Refresh on an interval and say how stale the numbers are, so a frozen
  // board is obvious rather than quietly wrong.
  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    const tick = setInterval(() => {
      const mins = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 60000);
      setAge(mins < 1 ? "just now" : `${mins}m ago`);
    }, 15_000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router, generatedAt]);

  const sales = data.sales.ok ? data.sales.value : null;
  const totals = sales
    ? sales.stores.reduce(
        (a, s) => ({ today: a.today + s.todayRevenue, last30: a.last30 + s.last30 }),
        { today: 0, last30: 0 }
      )
    : null;

  const cs = data.customerService.ok ? data.customerService.value : null;
  const wh = data.warehouse.ok ? data.warehouse.value : null;
  const perf = data.performers.ok ? data.performers.value : null;
  const col = data.collection.ok ? data.collection.value : null;

  return (
    <div className="w-screen h-screen bg-slate-900 text-slate-50 overflow-hidden flex flex-col gap-5 px-10 py-9 box-border">
      {/* Header */}
      <header className="flex items-center justify-between gap-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold tracking-wide">RF</span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold leading-tight">Today — {today}</h1>
            <p className="text-[15px] text-slate-400">Operations · updated {age}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-slate-800 rounded-xl px-6 py-3 border border-white/[0.08] text-right">
            <p className="text-[15px] text-slate-400">All stores today</p>
            <p className="text-[34px] font-semibold tabular-nums leading-tight">
              {totals ? formatCADWhole(totals.today) : "—"}
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl px-6 py-3 border border-white/[0.08] text-right">
            <p className="text-[15px] text-slate-400">Last 30 days</p>
            <p className="text-[34px] font-semibold tabular-nums leading-tight">
              {totals ? formatCADShort(totals.last30) : "—"}
            </p>
          </div>
        </div>
      </header>

      {/* Stores */}
      <div className="grid grid-cols-3 gap-5 shrink-0">
        {sales
          ? sales.stores.map((s) => {
              const targetPct = s.target ? (s.last30 / s.target) * 100 : null;
              const d = deltaText(s.todayRevenue, s.priorAverageToHour);
              return (
                <Card key={s.id}>
                  <div className="flex items-center justify-between">
                    <Label>{s.label}</Label>
                    {d && <span className={`text-[15px] font-medium ${d.tone}`}>{d.text}</span>}
                  </div>
                  <p className="text-[60px] font-semibold tabular-nums leading-none mt-2">
                    {formatCADWhole(s.todayRevenue)}
                  </p>
                  <div className="flex items-baseline gap-6 mt-4 text-[28px] tabular-nums">
                    <span>
                      <span className="text-[15px] text-slate-400 mr-2">7d</span>
                      {formatCADShort(s.last7)}
                    </span>
                    <span>
                      <span className="text-[15px] text-slate-400 mr-2">30d</span>
                      {formatCADShort(s.last30)}
                    </span>
                    <span
                      className={
                        targetPct === null
                          ? "text-slate-500 text-[20px]"
                          : targetPct >= 100
                          ? "text-emerald-400"
                          : targetPct >= 90
                          ? "text-amber-400"
                          : "text-red-400"
                      }
                    >
                      <span className="text-[15px] text-slate-400 mr-2">target</span>
                      {targetPct === null ? "not set" : `${targetPct.toFixed(0)}%`}
                    </span>
                  </div>
                </Card>
              );
            })
          : (
            <Card>
              <Label>Sales</Label>
              <p className="text-[28px] text-slate-500 mt-2">Unavailable</p>
            </Card>
          )}
      </div>

      {/* Ops row */}
      <div className="grid grid-cols-4 gap-5 flex-1 min-h-0">
        <Card>
          <Label>Warehouse output</Label>
          <div className="mt-4 space-y-3">
            {[
              ["Boxes built", wh?.today.boxesBuilt],
              ["Orders packed", wh?.today.ordersPacked],
              ["Walk-in / pick-up", wh?.today.walkinPickup],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-baseline justify-between">
                <span className="text-[15px] text-slate-400">{label as string}</span>
                <span className="text-[34px] font-semibold tabular-nums">
                  {wh ? num(value as number) : "—"}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <Label>Leaders · 30 days</Label>
          <div className="mt-4 space-y-4">
            {[
              ["Sales", perf?.sales[0]],
              ["Warehouse", perf?.warehouse[0]],
              ["Service", perf?.customerService[0]],
            ].map(([dept, p]) => {
              const person = p as { name: string; value: number } | undefined;
              return (
                <div key={String(dept)}>
                  <p className="text-[15px] text-slate-400">{dept as string}</p>
                  <p className="text-[22px] font-semibold truncate">{person?.name ?? "—"}</p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card warn={Boolean(ticketStats && ticketStats.open > 0)}>
          <Label>Problems &amp; backlog</Label>
          <div className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-slate-400">Open tickets</span>
              <span className="text-[40px] font-semibold tabular-nums text-amber-400">
                {ticketStats ? num(ticketStats.open) : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-slate-400">Oldest</span>
              <span className="text-[28px] font-semibold tabular-nums">
                {ticketStats?.oldest ? `${ticketStats.oldest.ageDays}d` : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-slate-400">Glass to reorder</span>
              <span className="text-[28px] font-semibold tabular-nums">
                {wh ? num(wh.reorderSkus) : "—"}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <Label>Inventory</Label>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-[15px] text-slate-400">On hand</p>
              <p className="text-[34px] font-semibold tabular-nums">
                {wh ? formatCADShort(wh.inventoryValue) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[15px] text-slate-400">Inbound</p>
              <p className="text-[28px] font-semibold tabular-nums">
                {wh ? formatCADShort(wh.openPoValue) : "—"}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-3 gap-5 shrink-0">
        <Card>
          <Label>Calls · miss rate</Label>
          <div className="flex items-baseline gap-8 mt-3">
            {[
              ["yesterday", cs?.yesterday.missRate],
              ["7d", cs?.last7.missRate],
              ["30d", cs?.last30.missRate],
            ].map(([label, value]) => {
              const v = value as number | null | undefined;
              return (
                <div key={String(label)}>
                  <p className="text-[15px] text-slate-400">{label as string}</p>
                  <p
                    className={`text-[40px] font-semibold tabular-nums leading-tight ${
                      v === null || v === undefined
                        ? "text-slate-500"
                        : v <= 10
                        ? "text-emerald-400"
                        : v <= 15
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {pct(v)}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <Label>Callback rate</Label>
          <div className="flex items-baseline gap-8 mt-3">
            {[
              ["yesterday", cs?.yesterday.callbackRate],
              ["7d", cs?.last7.callbackRate],
              ["30d", cs?.last30.callbackRate],
            ].map(([label, value]) => {
              const v = value as number | null | undefined;
              return (
                <div key={String(label)}>
                  <p className="text-[15px] text-slate-400">{label as string}</p>
                  <p
                    className={`text-[40px] font-semibold tabular-nums leading-tight ${
                      v === null || v === undefined
                        ? "text-slate-500"
                        : v >= 85
                        ? "text-emerald-400"
                        : v >= 70
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {pct(v)}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <Label>Collection</Label>
          {col ? (
            <div className="flex items-baseline gap-8 mt-3">
              <div>
                <p className="text-[15px] text-slate-400">To collect</p>
                <p className="text-[40px] font-semibold tabular-nums leading-tight">
                  {formatCADShort(col.totalUnpaid)}
                </p>
              </div>
              <div>
                <p className="text-[15px] text-slate-400">Over 60d</p>
                <p className="text-[40px] font-semibold tabular-nums leading-tight text-red-400">
                  {formatCADShort(col.over60Amount)}
                </p>
              </div>
            </div>
          ) : (
            // The board has no session, so this is expected rather than broken —
            // say which, instead of showing a zero that reads as "nothing owed".
            <p className="text-[20px] text-slate-500 mt-4">Not available on the wall board</p>
          )}
        </Card>
      </div>
    </div>
  );
}
