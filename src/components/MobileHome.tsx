"use client";

import Link from "next/link";
import useSWR from "swr";
import { useNativeRuntime } from "@/components/NativeAppRuntime";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import type { MobileHomeState } from "@/lib/mobile-types";
import { formatDuration } from "@/lib/time-clock";

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function HomeSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your daily view">
      <div className="h-14 w-64 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-20 animate-pulse rounded-2xl bg-slate-200" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-white" />)}
      </div>
      <div className="h-40 animate-pulse rounded-2xl bg-white" />
    </div>
  );
}

export default function MobileHome() {
  const { connected } = useNativeRuntime();
  const { data, error, isLoading, mutate } = useSWR<MobileHomeState>("/api/mobile/home", {
    refreshInterval: 60_000,
  });
  const now = new Date();

  if (isLoading && !data) return <HomeSkeleton />;
  if (!connected || (error && !data)) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-amber-200 bg-white p-6 text-center shadow-sm" role="alert">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-xl" aria-hidden="true">!</div>
        <h1 className="mt-4 text-xl font-bold text-slate-950">Your daily view is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {connected ? "RF Tools could not load your current work." : "Reconnect to Wi-Fi or cellular data, then try again."}
        </p>
        <button type="button" disabled={!connected} onClick={() => void mutate()} className="mt-5 min-h-12 w-full rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white disabled:opacity-50">
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <HomeSkeleton />;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);
  const firstName = data.profile?.name.split(/\s+/)[0];
  const open = data.clock.open;
  const elapsed = open && !open.stale
    ? formatDuration(Math.floor((now.getTime() - Date.parse(open.clockInAt)) / 60_000))
    : null;

  return (
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">
          {greeting(now)}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {today}{data.profile?.locationName ? ` · ${data.profile.locationName}` : ""}
        </p>
      </header>

      {data.clock.linked ? (
        <Link
          href="/clock"
          aria-label={open?.stale ? "Clock status needs attention" : open ? `Clocked in for ${elapsed}` : "Not clocked in. Open the clock"}
          className={`flex min-h-20 items-center justify-between rounded-2xl px-4 py-4 text-white shadow-sm active:scale-[0.99] ${
            open?.stale ? "bg-amber-700" : open ? "bg-emerald-700" : "bg-blue-900"
          }`}
        >
          <span>
            <span className="block text-xs font-bold uppercase tracking-wider opacity-75">Clock</span>
            <span className="mt-1 block text-sm font-bold">{open?.stale ? "Shift needs attention" : open ? "Clocked in" : "Not clocked in"}</span>
          </span>
          <span className="text-base font-bold tabular-nums">{open?.stale ? "Fix shift" : elapsed ?? "Clock in"}</span>
        </Link>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900" role="status">
          Your login is not linked to an employee profile. Ask your manager to connect your email.
        </div>
      )}

      <section aria-labelledby="task-summary-title">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 id="task-summary-title" className="text-xs font-bold uppercase tracking-wider text-slate-600">Today</h2>
          <Link href="/todos" className="flex min-h-11 items-center px-1 text-sm font-bold text-blue-600">View tasks</Link>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {[
            ["Active", data.tasks.active, "text-slate-950"],
            ["Due today", data.tasks.dueToday, "text-amber-700"],
            ["Overdue", data.tasks.overdue, data.tasks.overdue > 0 ? "text-red-700" : "text-slate-950"],
          ].map(([label, value, tone], index) => (
            <div key={label as string} className={`px-2 py-4 text-center ${index > 0 ? "border-l border-slate-100" : ""}`}>
              <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="role-work-title">
        <h2 id="role-work-title" className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-slate-600">Your work</h2>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {data.roleActions.map((action) => {
            const content = <><span><span className="block text-sm font-bold text-slate-950">{action.label}</span><span className="mt-0.5 block text-xs text-slate-500">{action.description}</span></span><span className="text-xl text-slate-300" aria-hidden="true">{action.external ? "↗" : "›"}</span>{action.external && <span className="sr-only">Opens outside RF Tools</span>}</>;
            const className = "flex min-h-16 items-center justify-between gap-4 px-4 py-3 active:bg-slate-50";
            return action.external
              ? <a key={action.id} href={action.href} target="_blank" rel="noreferrer" className={className}>{content}</a>
              : <Link key={action.id} href={action.href} className={className}>{content}</Link>;
          })}
        </div>
      </section>

      {data.clock.weekMinutes > 0 && (
        <p className="text-center text-xs font-semibold text-slate-600">{formatDuration(data.clock.weekMinutes)} worked this week</p>
      )}
    </div>
  );
}
