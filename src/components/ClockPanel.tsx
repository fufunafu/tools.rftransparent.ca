"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { formatDuration, type WeekDay } from "@/lib/time-clock";
import { getCurrentPosition, type AppPosition } from "@/lib/app-geolocation";
import { hapticSuccess, hapticWarning } from "@/lib/app-haptics";
import { useNativeRuntime } from "@/components/NativeAppRuntime";

interface ClockStatus {
  linked: boolean;
  employeeName?: string;
  locationName?: string | null;
  // True when this employee's store requires the phone's location to clock in.
  geofenced?: boolean;
  geofenceReady?: boolean;
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
  const { connected } = useNativeRuntime();
  const { data, error, mutate } = useSWR<ClockStatus>("/api/clock", { refreshInterval: 60_000 });
  const [pending, setPending] = useState(false);
  const [locating, setLocating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showLocationEducation, setShowLocationEducation] = useState(false);
  const [resolveValue, setResolveValue] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const running = !!data?.open && !data.open.stale;

  // Tick once a second only while a shift is actually running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const acquireLocationAndClockIn = async () => {
    setPending(true);
    setLocating(true);
    setActionError(null);
    setActionSuccess(null);
    const result = await getCurrentPosition();
    setLocating(false);
    if (!result.ok) {
      const message =
        result.reason === "denied"
          ? "Location access is off. Enable Location for RF Tools in iPhone Settings, then try again."
          : result.reason === "restricted"
            ? "Location access is restricted on this device. Ask your manager for help."
            : result.reason === "timeout"
              ? "Your location took too long. Move near a window or outdoors and try again."
              : result.reason === "inaccurate"
                ? `Your location is only accurate to about ${result.accuracy} m. Move near a window or outdoors and try again.`
                : "Couldn't get your location. Check that Location Services are on and try again.";
      setActionError(message);
      setPending(false);
      return;
    }
    await post({ action: "in", position: result.position });
  };

  const clockIn = async () => {
    if (!connected || !navigator.onLine) {
      setActionError("Clocking in needs an internet connection. Reconnect and try again.");
      setActionSuccess(null);
      return;
    }
    if (data?.geofenced && data.geofenceReady === false) {
      setActionError("Your store's clock-in location needs a manager to fix it before you can clock in.");
      setActionSuccess(null);
      return;
    }
    if (!data?.geofenced) {
      await post({ action: "in" });
      return;
    }
    setShowLocationEducation(true);
  };

  const post = async (body: {
    action: string;
    clockOutAt?: string;
    position?: AppPosition;
  }) => {
    if (!connected || !navigator.onLine) {
      setActionError("Clock actions need an internet connection. Reconnect and try again.");
      setActionSuccess(null);
      setLocating(false);
      setPending(false);
      return;
    }
    setPending(true);
    setActionError(null);
    setActionSuccess(null);
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
        void hapticWarning();
        return;
      }
      setResolveValue("");
      await mutate(payload, { revalidate: false });
      if (body.action === "in" || body.action === "out") void hapticSuccess();
      setActionSuccess(
        body.action === "in"
          ? "Clock-in confirmed by RF Tools."
          : body.action === "out"
            ? "Clock-out confirmed by RF Tools."
            : "Your shift end time was saved for manager review.",
      );
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
              className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
              aria-label="When your shift actually ended"
            />
            <button
              onClick={() => post({ action: "resolve", clockOutAt: resolveValue ? new Date(resolveValue).toISOString() : "" })}
              disabled={pending || !resolveValue}
              className="mt-3 min-h-12 w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
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
          onClick={() => (open ? post({ action: "out" }) : clockIn())}
          disabled={pending || !connected}
          className={`w-full rounded-2xl py-4 text-lg font-bold text-white shadow-lg transition-colors disabled:opacity-50 ${
            open
              ? "bg-stone-900 shadow-stone-900/20 hover:bg-stone-800"
              : "bg-blue-600 shadow-blue-600/25 hover:bg-blue-700"
          }`}
        >
          {!connected
            ? "Offline"
            : locating
              ? "Checking you're at the store..."
              : pending
                ? "One sec..."
                : open
                  ? "Clock Out"
                  : "Clock In"}
        </button>
      )}

      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" aria-live="assertive">{actionError}</p>
      )}
      {actionSuccess && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" role="status" aria-live="polite">{actionSuccess}</p>
      )}

      {data.geofenced && !open && (
        <p className="px-2 text-center text-xs leading-5 text-slate-500">
          RF Tools checks your location once when you clock in. It does not track you afterward.
        </p>
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

      {showLocationEducation && (
        <div
          className="fixed inset-0 z-[90] flex items-end bg-slate-950/45 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="location-education-title"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6-5.25 6-11a6 6 0 1 0-12 0c0 5.75 6 11 6 11Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" />
              </svg>
            </div>
            <h2 id="location-education-title" className="text-xl font-bold tracking-tight text-slate-950">
              Confirm you are at the store
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              RF Tools will request one fresh location to confirm you are near {data.locationName ?? "your assigned store"}. The reading is saved with this clock-in for audit purposes.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowLocationEducation(false);
                void acquireLocationAndClockIn();
              }}
              className="mt-6 min-h-12 w-full rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white active:scale-[0.99]"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => setShowLocationEducation(false)}
              className="mt-2 min-h-11 w-full rounded-xl px-4 text-sm font-semibold text-slate-500"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
