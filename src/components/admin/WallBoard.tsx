"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { formatCADWhole, formatCADShort } from "@/lib/format";
import type { OpsDashboard as OpsData, Performer } from "@/lib/ops-dashboard";
import type { TicketStats } from "@/lib/home-dashboard";
import type { WallAnnouncement } from "@/lib/settings";

// The office wall board (design 1b). Glanceable, not a show: no animation,
// nothing clickable, nothing under 14px, and it must fit 1080px without
// scrolling. Two deliberate departures from the design, both at the owner's
// request: warehouse output leads with 7d/30d totals because the daily report
// isn't filed every day (a wall of zeros reads as "nobody worked"), and the
// inventory card is dropped — glass-to-reorder moves into Problems & backlog.

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

function missTone(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-slate-500";
  return v <= 10 ? "text-emerald-400" : v <= 15 ? "text-amber-400" : "text-red-400";
}

function callbackTone(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-slate-500";
  return v >= 85 ? "text-emerald-400" : v >= 70 ? "text-amber-400" : "text-red-400";
}

function Card({
  title,
  warn = false,
  footer,
  children,
}: {
  title: React.ReactNode;
  warn?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-slate-800 rounded-2xl border flex flex-col overflow-hidden ${
        warn ? "border-amber-400/40" : "border-white/[0.08]"
      }`}
    >
      <p className="px-5 pt-4 text-[15px] font-medium uppercase tracking-wider text-slate-400 shrink-0">
        {title}
      </p>
      {/* min-h-0 + hidden overflow: if content ever exceeds the card, the
          middle clips — the footer must never be what gets pushed out. */}
      <div className="px-5 pb-4 pt-2 flex-1 min-h-0 overflow-hidden">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-white/[0.08] text-[15px] text-slate-400 shrink-0">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Some follow-up logs are signed with an email rather than a name. Across a
 * room, "aissatou" reads; "aissatou…89@gmail.com" doesn't.
 */
function displayName(name: string): string {
  return name.includes("@") ? name.split("@")[0] : name;
}

/** "Week of Jul 27" — the Monday of the week an announcement was posted. */
function weekOfLabel(iso: string): string {
  const posted = new Date(iso);
  const monday = new Date(posted);
  monday.setDate(posted.getDate() - ((posted.getDay() + 6) % 7));
  return `Week of ${monday.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
}

export default function WallBoard({
  data,
  today,
  ticketStats,
  announcement,
  generatedAt,
}: {
  data: OpsData;
  today: string;
  ticketStats: TicketStats | null;
  announcement: WallAnnouncement | null;
  generatedAt: string;
}) {
  const router = useRouter();
  const [age, setAge] = useState("just now");
  const [scale, setScale] = useState(1);

  // Refresh on an interval and say how stale the numbers are, so a frozen
  // board is obvious rather than quietly wrong. The TV is always visible so
  // the hook's visibility pause never fires there; it only spares a
  // backgrounded browser tab from re-rendering the board all day.
  useAutoRefresh(() => router.refresh(), { intervalMs: REFRESH_MS });
  useEffect(() => {
    const tick = setInterval(() => {
      const mins = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 60000);
      setAge(mins < 1 ? "just now" : `${mins}m ago`);
    }, 15_000);
    return () => clearInterval(tick);
  }, [generatedAt]);

  // The board is laid out on a fixed 1920×1080 canvas and scaled to fit
  // whatever it's shown on. Letting it reflow instead meant a browser window
  // (~940px tall once chrome is counted) squeezed the middle row until card
  // footers were pushed out of view.
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const sales = data.sales.ok ? data.sales.value : null;
  const cs = data.customerService.ok ? data.customerService.value : null;
  const wh = data.warehouse.ok ? data.warehouse.value : null;
  const perf = data.performers.ok ? data.performers.value : null;
  const col = data.collection.ok ? data.collection.value : null;

  const totals = sales
    ? sales.stores.reduce(
        (a, s) => ({ today: a.today + s.todayRevenue, last30: a.last30 + s.last30 }),
        { today: 0, last30: 0 }
      )
    : null;

  const down = [
    !data.sales.ok && "sales",
    !data.warehouse.ok && "warehouse",
    !data.customerService.ok && "calls",
    !data.performers.ok && "performers",
  ].filter(Boolean) as string[];

  // Full top-3 per department, each with its own value formatting.
  const leaderColumns: { dept: string; people: Performer[]; fmt: (n: number) => string }[] = [
    { dept: "Warehouse", people: perf?.warehouse.slice(0, 3) ?? [], fmt: (n) => `${num(n)} u` },
    { dept: "Sales", people: perf?.sales.slice(0, 3) ?? [], fmt: formatCADShort },
    { dept: "Customer service", people: perf?.customerService.slice(0, 3) ?? [], fmt: num },
  ];

  // The design orders the store cards GRS · RF · BC.
  const WALL_STORE_ORDER = ["GRS", "RF", "BC"];
  const orderedStores = sales
    ? [...sales.stores].sort(
        (a, b) => WALL_STORE_ORDER.indexOf(a.code) - WALL_STORE_ORDER.indexOf(b.code)
      )
    : [];

  return (
    <div className="w-screen h-screen bg-slate-900 overflow-hidden flex items-center justify-center">
      <div
        className="w-[1920px] h-[1080px] shrink-0 text-slate-50 flex flex-col gap-4 px-10 py-8 box-border"
        style={{ transform: `scale(${scale})` }}
      >
      {/* Header */}
      <header className="flex items-center justify-between gap-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold tracking-wide">RF</span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold leading-tight">Today — {today}</h1>
            <p className="text-[15px] text-slate-400">
              Updated {age} ·{" "}
              {down.length === 0 ? "all sources live" : `${down.join(", ")} unavailable`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-slate-800 rounded-xl px-6 py-3 border border-white/[0.08] text-right">
            <p className="text-[14px] uppercase tracking-wider text-slate-400">All stores today</p>
            <p className="text-[32px] font-semibold tabular-nums leading-tight">
              {totals ? formatCADWhole(totals.today) : "—"}
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl px-6 py-3 border border-white/[0.08] text-right">
            <p className="text-[14px] uppercase tracking-wider text-slate-400">Last 30 days</p>
            <p className="text-[32px] font-semibold tabular-nums leading-tight text-emerald-400">
              {totals ? formatCADWhole(totals.last30) : "—"}
            </p>
          </div>
        </div>
      </header>

      {/* Announcement — one line the whole office should see. Hidden when
          nothing is posted, so the board never shows an empty frame. */}
      {announcement && (
        <div className="shrink-0 flex items-center gap-6 bg-slate-800 rounded-2xl border border-white/[0.08] border-l-4 border-l-blue-500 px-6 py-4">
          <div className="shrink-0">
            <p className="text-[14px] font-semibold uppercase tracking-wider text-blue-400">
              Announcement
            </p>
            <p className="text-[14px] text-slate-400">{weekOfLabel(announcement.updated_at)}</p>
          </div>
          <p className="flex-1 text-[26px] font-semibold leading-snug truncate">
            {announcement.message}
          </p>
          <p className="shrink-0 text-[16px] text-slate-400">— {announcement.author}</p>
        </div>
      )}

      {/* Stores */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        {sales ? (
          orderedStores.map((s) => {
            const targetPct = s.target ? (s.last30 / s.target) * 100 : null;
            const d = deltaText(s.todayRevenue, s.priorAverageToHour);
            return (
              <div key={s.id} className="bg-slate-800 rounded-2xl border border-white/[0.08] p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-medium uppercase tracking-wider text-slate-400">
                    {s.label}
                  </p>
                  <span className="text-[14px] font-bold text-blue-400 bg-blue-400/10 rounded-md px-2 py-0.5">
                    {s.code}
                  </span>
                </div>
                <p className="text-[54px] font-semibold tabular-nums leading-none mt-3">
                  {formatCADWhole(s.todayRevenue)}
                </p>
                <p className="text-[15px] text-slate-400 mt-2">
                  today · {s.todayOrders} order{s.todayOrders === 1 ? "" : "s"}
                  {d && (
                    <span className={`ml-2 font-medium ${d.tone}`}>{d.text}</span>
                  )}
                </p>
                <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/[0.08]">
                  <div>
                    <p className="text-[14px] text-slate-400">7 days</p>
                    <p className="text-[24px] font-semibold tabular-nums">{formatCADShort(s.last7)}</p>
                  </div>
                  <div>
                    <p className="text-[14px] text-slate-400">30 days</p>
                    <p className="text-[24px] font-semibold tabular-nums">{formatCADShort(s.last30)}</p>
                  </div>
                  <div>
                    <p className="text-[14px] text-slate-400">vs target</p>
                    <p
                      className={`text-[24px] font-semibold tabular-nums ${
                        targetPct === null
                          ? "text-slate-500"
                          : targetPct >= 100
                          ? "text-emerald-400"
                          : targetPct >= 90
                          ? "text-amber-400"
                          : "text-red-400"
                      }`}
                    >
                      {targetPct === null ? "—" : `${targetPct.toFixed(0)}%`}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-3 bg-slate-800 rounded-2xl border border-white/[0.08] p-5">
            <p className="text-[15px] uppercase tracking-wider text-slate-400">Sales</p>
            <p className="text-[28px] text-slate-500 mt-2">Unavailable</p>
          </div>
        )}
      </div>

      {/* Ops row — leaders get the wide middle slot, as in the design. */}
      <div className="grid grid-cols-[500px_1fr_440px] gap-4 flex-1 min-h-0">
        {/* Daily reports aren't filed every day, so today's number is often a
            true-but-useless 0. Windows tell the story; the footer says how
            current they are. */}
        <Card
          title="Warehouse output"
          footer={
            wh ? (
              <>
                Daily reports · last filed{" "}
                <span className="text-slate-50 font-semibold">
                  {wh.lastReportDate
                    ? new Date(wh.lastReportDate + "T12:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "never"}
                </span>
                {wh.lastReportDate && (
                  <>
                    , {wh.filedOnLastDate} of {wh.warehouseCrew} crew
                  </>
                )}
              </>
            ) : undefined
          }
        >
          {/* Column headers, matching the design's 7 DAYS / 30 DAYS table. */}
          <div className="grid grid-cols-[1fr_130px_130px] items-baseline mt-1">
            <span />
            <span className="text-[14px] uppercase tracking-wider text-slate-400 text-right">7 days</span>
            <span className="text-[14px] uppercase tracking-wider text-slate-400 text-right">30 days</span>
          </div>
          <div className="mt-3 space-y-5">
            {[
              ["Boxes built", wh?.last7.boxesBuilt, wh?.last30.boxesBuilt],
              ["Orders packed", wh?.last7.ordersPacked, wh?.last30.ordersPacked],
              ["Walk-in / pick-up", wh?.last7.walkinPickup, wh?.last30.walkinPickup],
            ].map(([label, week, month]) => (
              <div key={String(label)} className="grid grid-cols-[1fr_130px_130px] items-baseline">
                <span className="text-[16px] text-slate-400">{label as string}</span>
                <span className="text-[36px] font-semibold tabular-nums text-right">
                  {wh ? num(week as number) : "—"}
                </span>
                <span className="text-[36px] font-semibold tabular-nums text-right">
                  {wh ? num(month as number) : "—"}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Leaders · last 30 days"
          footer={<>Units built + packed + walk-in · net sold · follow-ups logged</>}
        >
          <div className="grid grid-cols-3 gap-6 mt-2">
            {leaderColumns.map((col) => (
              <div key={col.dept} className="min-w-0">
                <p className="text-[14px] uppercase tracking-wider text-slate-400">{col.dept}</p>
                {col.people.length === 0 ? (
                  <p className="text-[20px] text-slate-500 mt-2">—</p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {/* #1 large, #2–3 smaller — readable across the room. */}
                    <div>
                      <p className="text-[22px] font-semibold leading-tight truncate">
                        {displayName(col.people[0].name)}
                      </p>
                      <p className="text-[20px] font-semibold text-blue-400 tabular-nums">
                        {col.fmt(col.people[0].value)}
                      </p>
                    </div>
                    {col.people.slice(1).map((p, i) => (
                      <div key={p.id} className="flex items-baseline justify-between gap-2 border-t border-white/[0.08] pt-2">
                        <span className="text-[16px] text-slate-300 truncate">
                          <span className="text-slate-500 mr-1.5">{i + 2}</span>
                          {displayName(p.name)}
                        </span>
                        <span className="text-[16px] text-slate-400 tabular-nums shrink-0">
                          {col.fmt(p.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Problems & backlog"
          warn={Boolean(ticketStats && ticketStats.open > 0)}
          footer={
            wh ? (
              <>
                Unfulfilled <span className="text-slate-50 font-semibold">{num(wh.unfulfilled)}</span>
                {wh.oldestUnfulfilledDays !== null && (
                  <>
                    {" "}· oldest{" "}
                    <span className="text-amber-400 font-semibold">{wh.oldestUnfulfilledDays}d</span>
                  </>
                )}
              </>
            ) : undefined
          }
        >
          <div className="mt-2 space-y-4">
            <div>
              <p className="text-[15px] text-slate-400">Open tickets</p>
              <p className="text-[44px] font-semibold tabular-nums leading-none text-amber-400">
                {ticketStats ? num(ticketStats.open) : "—"}
              </p>
              {ticketStats && (
                <p className="text-[15px] text-slate-400 mt-1">
                  {ticketStats.overAlertAge} over {ticketStats.alertDays} days
                </p>
              )}
            </div>
            <div>
              <p className="text-[15px] text-slate-400">Oldest ticket</p>
              <p className="text-[30px] font-semibold tabular-nums leading-tight text-red-400">
                {ticketStats?.oldest ? `${ticketStats.oldest.ageDays} days` : "—"}
              </p>
              {ticketStats?.oldest && (
                <p className="text-[15px] text-slate-400">{ticketStats.oldest.client_name}</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        <Card
          title="Calls — miss rate"
          footer={
            cs ? (
              <>
                Callback rate{" "}
                <span className={callbackTone(cs.yesterday.callbackRate)}>{pct(cs.yesterday.callbackRate)}</span>
                {" / "}
                <span className={callbackTone(cs.last7.callbackRate)}>{pct(cs.last7.callbackRate)}</span>
                {" / "}
                <span className={callbackTone(cs.last30.callbackRate)}>{pct(cs.last30.callbackRate)}</span>
              </>
            ) : undefined
          }
        >
          <div className="flex items-baseline gap-8 mt-2">
            {[
              [cs?.yesterdayLabel ?? "Yesterday", cs?.yesterday.missRate],
              ["7 days", cs?.last7.missRate],
              ["30 days", cs?.last30.missRate],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-[15px] text-slate-400">{label as string}</p>
                <p
                  className={`text-[38px] font-semibold tabular-nums leading-tight ${missTone(
                    value as number | null | undefined
                  )}`}
                >
                  {pct(value as number | null | undefined)}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Quotes sent"
          footer={
            cs ? (
              <>
                Quoted <span className="text-slate-50 font-semibold">{formatCADShort(cs.quotes.quotedValue30)}</span>
                {" · "}conversion{" "}
                <span className="text-slate-50 font-semibold">{pct(cs.quotes.conversion30)}</span>
              </>
            ) : undefined
          }
        >
          <div className="flex items-baseline gap-8 mt-2">
            {[
              ["Yesterday", cs?.quotes.yesterday],
              ["7 days", cs?.quotes.last7],
              ["30 days", cs?.quotes.last30],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-[15px] text-slate-400">{label as string}</p>
                <p className="text-[38px] font-semibold tabular-nums leading-tight">
                  {cs ? num(value as number) : "—"}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title={
            <>
              Collection{" "}
              <span className="ml-1 text-[13px] font-bold normal-case tracking-normal text-blue-400 bg-blue-400/10 rounded-md px-2 py-0.5 align-middle">
                RF only
              </span>
            </>
          }
          footer={
            col?.oldest ? (
              <>
                Oldest: {col.oldest.name} ·{" "}
                <span className="text-red-400 font-semibold">{col.oldest.days} days</span> ·{" "}
                {formatCADWhole(col.oldest.amount)}
              </>
            ) : undefined
          }
        >
          {col ? (
            <div className="flex items-baseline gap-8 mt-2">
              <div>
                <p className="text-[15px] text-slate-400">30+ days</p>
                <p className="text-[38px] font-semibold tabular-nums leading-tight text-amber-400">
                  {num(col.over30Count)}
                </p>
              </div>
              <div>
                <p className="text-[15px] text-slate-400">60+ days</p>
                <p className="text-[38px] font-semibold tabular-nums leading-tight text-red-400">
                  {num(col.over60Count)}
                </p>
              </div>
              <div>
                <p className="text-[15px] text-slate-400">To collect</p>
                <p className="text-[38px] font-semibold tabular-nums leading-tight">
                  {formatCADShort(col.totalUnpaid)}
                </p>
              </div>
            </div>
          ) : (
            // Shopify unreachable — say so instead of a zero that reads as
            // "nothing owed".
            <p className="text-[20px] text-slate-500 mt-3">Unavailable</p>
          )}
        </Card>
      </div>
      </div>
    </div>
  );
}
