"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { formatDuration, type WeekDay } from "@/lib/time-clock";

interface ClockStatus {
  linked: boolean;
  employeeName?: string;
  locationName?: string | null;
  open?: { id: string; clockInAt: string; stale: boolean } | null;
  week?: WeekDay[];
  weekMinutes?: number;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatClockTime(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function formatClockDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export default function ClockPanel() {
  const { data, error, mutate } = useSWR<ClockStatus>("/api/clock", { refreshInterval: 60_000 });
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolveValue, setResolveValue] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const running = !!data?.open && !data.open.stale;

  // Tick once a second only while a shift is actually running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const post = async (body: { action: string; clockOutAt?: string }) => {
    setPending(true);
    setActionError(null);
    try {
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        // A 409 means our view of the shift was out of date — refetch so the
        // UI shows the real state (e.g. the stale-shift prompt).
        if (res.status === 409) await mutate();
        setActionError(payload?.error ?? "Something went wrong. Try again.");
        return;
      }
      setResolveValue("");
      await mutate(payload, { revalidate: false });
    } catch {
      setActionError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  // datetime-local bounds for the forgot-to-clock-out prompt, in device time.
  const resolveBounds = useMemo(() => {
    if (!data?.open) return null;
    const toLocalInput = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    return { min: toLocalInput(new Date(data.open.clockInAt)), max: toLocalInput(new Date()) };
  }, [data?.open]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn&apos;t load the clock: {error.message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        <div className="h-14 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      </div>
    );
  }

  if (!data.linked) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">No employee profile linked</h2>
        <p className="text-sm text-slate-500">
          Your login isn&apos;t connected to an employee profile yet, so there&apos;s nothing to
          clock into. Ask your manager to add this email on the Employees page.
        </p>
      </div>
    );
  }

  const open = data.open;
  const elapsedMs = open ? now - Date.parse(open.clockInAt) : 0;

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        {open ? (
          open.stale ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Needs attention
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Clocked in
            </span>
          )
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Clocked out
          </span>
        )}

        {open && !open.stale ? (
          <>
            <div className="mt-3 text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">
              {formatElapsed(elapsedMs)}
            </div>
            <div className="mt-1 text-xs text-slate-500">Since {formatClockTime(open.clockInAt)}</div>
          </>
        ) : !open ? (
          <>
            <div className="mt-3 text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">0:00</div>
            <div className="mt-1 text-xs text-slate-500">
              {data.locationName ? `${data.locationName} · ` : ""}This week: {formatDuration(data.weekMinutes ?? 0)}
            </div>
          </>
        ) : null}

        {open?.stale && (
          <div className="mt-4 text-left">
            <p className="text-sm text-slate-600">
              Looks like you forgot to clock out — this shift started{" "}
              <strong className="font-semibold text-slate-900">
                {formatClockDay(open.clockInAt)} at {formatClockTime(open.clockInAt)}
              </strong>
              . When did it actually end?
            </p>
            <input
              type="datetime-local"
              value={resolveValue}
              min={resolveBounds?.min}
              max={resolveBounds?.max}
              onChange={(e) => setResolveValue(e.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
              aria-label="When your shift actually ended"
            />
            <button
              onClick={() => post({ action: "resolve", clockOutAt: resolveValue ? new Date(resolveValue).toISOString() : "" })}
              disabled={pending || !resolveValue}
              className="mt-3 w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Confirm end time"}
            </button>
            <p className="mt-2 text-xs text-slate-400">
              A manager will see this entry was fixed after the fact.
            </p>
          </div>
        )}
      </div>

      {/* Main action */}
      {!open?.stale && (
        <button
          onClick={() => post({ action: open ? "out" : "in" })}
          disabled={pending}
          className={`w-full rounded-2xl py-4 text-lg font-bold text-white shadow-lg transition-colors disabled:opacity-50 ${
            open
              ? "bg-stone-900 shadow-stone-900/20 hover:bg-stone-800"
              : "bg-blue-600 shadow-blue-600/25 hover:bg-blue-700"
          }`}
        >
          {pending ? "One sec…" : open ? "Clock Out" : "Clock In"}
        </button>
      )}

      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      {/* This week */}
      <div>
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">This week</h2>
          <span className="text-xs font-semibold tabular-nums text-slate-500">
            {formatDuration(data.weekMinutes ?? 0)}
          </span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(data.week ?? []).map((day) => (
            <div
              key={day.date}
              className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="text-slate-600">{day.label}</span>
              <span className={`font-semibold tabular-nums ${day.minutes === 0 && !day.open ? "font-normal text-slate-300" : "text-slate-900"}`}>
                {day.minutes === 0 && !day.open ? "—" : formatDuration(day.minutes)}
                {day.open && <span className="ml-1 text-emerald-500">·</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
