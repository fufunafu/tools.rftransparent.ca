"use client";

import { useState } from "react";
import useSWR from "swr";
import { SWRProvider } from "@/lib/swr-provider";
import {
  dayKeyInTimeZone,
  decimalHours,
  entryMinutes,
  formatDuration,
  isStaleShift,
  startOfWeekInTimeZone,
  weekDayKeys,
} from "@/lib/time-clock";
import { BUSINESS_TIMEZONE } from "@/lib/dates";

// Management's week view of clock in/out: everyone's hours in a grid, a
// review queue for flagged entries, per-employee shift editing with an audit
// note, and the payroll CSV export.

interface AdminEntry {
  id: string;
  employee_id: string;
  location_name: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  flagged: boolean;
  flag_reason: string | null;
  edited_by: string | null;
  edit_note: string | null;
}

interface HoursPayload {
  weekStart: string;
  employees: { id: string; name: string; department: string; locationName: string | null }[];
  entries: AdminEntry[];
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const timeFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const rangeFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  month: "short",
  day: "numeric",
});

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HoursPanelInner() {
  const [weekStart, setWeekStart] = useState(() => startOfWeekInTimeZone(new Date()));
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; clockIn: string; clockOut: string; note: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const key = `/api/clock/admin?start=${encodeURIComponent(weekStart.toISOString())}`;
  const { data, error, mutate } = useSWR<HoursPayload>(key);

  const now = new Date();
  const days = weekDayKeys(weekStart);
  const isCurrentWeek = weekStart.getTime() === startOfWeekInTimeZone(now).getTime();
  const weekEndLabel = rangeFmt.format(new Date(weekStart.getTime() + MS_PER_WEEK - 1));
  const weekStartLabel = rangeFmt.format(new Date(weekStart.getTime() + 12 * 60 * 60 * 1000));

  const entriesByEmployee = new Map<string, AdminEntry[]>();
  for (const entry of data?.entries ?? []) {
    const list = entriesByEmployee.get(entry.employee_id) ?? [];
    list.push(entry);
    entriesByEmployee.set(entry.employee_id, list);
  }
  const flagged = (data?.entries ?? []).filter((e) => e.flagged);
  const nameById = new Map((data?.employees ?? []).map((e) => [e.id, e.name]));

  const call = async (run: () => Promise<Response>) => {
    setBusy(true);
    setPanelError(null);
    try {
      const res = await run();
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setPanelError(body?.error ?? "That didn't save. Try again.");
        return false;
      }
      await mutate();
      return true;
    } catch {
      setPanelError("Couldn't reach the server. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>) =>
    call(() =>
      fetch("/api/clock/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const saveEdit = async () => {
    if (!editing) return;
    const ok = await patch({
      entryId: editing.id,
      clockInAt: new Date(editing.clockIn).toISOString(),
      clockOutAt: new Date(editing.clockOut).toISOString(),
      note: editing.note,
      clearFlag: true,
    });
    if (ok) setEditing(null);
  };

  const remove = async (entryId: string) => {
    const ok = await call(() =>
      fetch(`/api/clock/admin?entryId=${encodeURIComponent(entryId)}`, { method: "DELETE" }),
    );
    if (ok) setConfirmingDelete(null);
  };

  const entryRow = (entry: AdminEntry) => {
    const minutes = entryMinutes(entry, now);
    const openStale = !entry.clock_out_at && isStaleShift(entry.clock_in_at, now);
    return (
      <div key={entry.id} className="border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-28 text-slate-500">{dayFmt.format(new Date(entry.clock_in_at))}</span>
          <span className="tabular-nums text-slate-700">
            {timeFmt.format(new Date(entry.clock_in_at))} –{" "}
            {entry.clock_out_at ? timeFmt.format(new Date(entry.clock_out_at)) : openStale ? "?" : "now"}
          </span>
          <span className="font-semibold tabular-nums text-slate-900">
            {entry.clock_out_at ? formatDuration(minutes) : openStale ? "—" : `${formatDuration(minutes)} ·`}
          </span>
          {entry.flagged && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              needs review
            </span>
          )}
          <span className="ml-auto flex gap-2">
            {editing?.id !== entry.id && (
              <button
                onClick={() =>
                  setEditing({
                    id: entry.id,
                    clockIn: toLocalInput(entry.clock_in_at),
                    clockOut: entry.clock_out_at ? toLocalInput(entry.clock_out_at) : toLocalInput(new Date().toISOString()),
                    note: "",
                  })
                }
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                Edit
              </button>
            )}
            {confirmingDelete === entry.id ? (
              <button
                onClick={() => remove(entry.id)}
                disabled={busy}
                className="text-xs font-bold text-red-600 hover:text-red-800"
              >
                Really delete?
              </button>
            ) : (
              <button
                onClick={() => setConfirmingDelete(entry.id)}
                className="text-xs font-semibold text-slate-400 hover:text-red-600"
              >
                Delete
              </button>
            )}
          </span>
        </div>
        {(entry.flag_reason || entry.edited_by) && (
          <p className="mt-1 text-xs text-slate-400">
            {entry.flag_reason}
            {entry.edited_by && (
              <>
                {entry.flag_reason ? " · " : ""}Edited by {entry.edited_by}
                {entry.edit_note ? ` — ${entry.edit_note}` : ""}
              </>
            )}
          </p>
        )}
        {editing?.id === entry.id && (
          <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-500">
              Clock in
              <input
                type="datetime-local"
                value={editing.clockIn}
                onChange={(e) => setEditing({ ...editing, clockIn: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
              />
            </label>
            <label className="text-xs font-semibold text-slate-500">
              Clock out
              <input
                type="datetime-local"
                value={editing.clockOut}
                onChange={(e) => setEditing({ ...editing, clockOut: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
              />
            </label>
            <label className="text-xs font-semibold text-slate-500 sm:col-span-2">
              Why the change?
              <input
                type="text"
                value={editing.note}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                placeholder="e.g. Left early for an appointment"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
              />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button
                onClick={saveEdit}
                disabled={busy}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Week picker + export */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setWeekStart(startOfWeekInTimeZone(new Date(weekStart.getTime() - MS_PER_WEEK + 12 * 60 * 60 * 1000)))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="min-w-40 text-center text-sm font-semibold text-slate-800">
          {weekStartLabel} – {weekEndLabel}
          {isCurrentWeek && <span className="ml-1.5 text-xs font-normal text-slate-400">(this week)</span>}
        </span>
        <button
          onClick={() => setWeekStart(startOfWeekInTimeZone(new Date(weekStart.getTime() + MS_PER_WEEK + 12 * 60 * 60 * 1000)))}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
          aria-label="Next week"
        >
          ›
        </button>
        <a
          href={`/api/clock/admin?start=${encodeURIComponent(weekStart.toISOString())}&format=csv`}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          Export CSV
        </a>
      </div>

      {panelError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{panelError}</p>
      )}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&apos;t load hours: {error.message}
        </p>
      )}

      {/* Review queue */}
      {flagged.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600">
            Needs review ({flagged.length})
          </h3>
          <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
            {flagged.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-2 border-b border-amber-100 px-4 py-2.5 text-sm last:border-b-0">
                <span className="font-semibold text-slate-900">{nameById.get(entry.employee_id) ?? "?"}</span>
                <span className="text-slate-500">
                  {dayFmt.format(new Date(entry.clock_in_at))} · {timeFmt.format(new Date(entry.clock_in_at))} –{" "}
                  {entry.clock_out_at ? timeFmt.format(new Date(entry.clock_out_at)) : "?"}
                </span>
                <span className="text-xs text-slate-400">{entry.flag_reason}</span>
                <button
                  onClick={() => patch({ entryId: entry.id, clearFlag: true })}
                  disabled={busy}
                  className="ml-auto rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => setExpanded(entry.employee_id)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  Details
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week grid */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2.5 font-bold">Employee</th>
              {days.map((d) => (
                <th key={d.date} className="px-2 py-2.5 text-right font-bold">{d.label}</th>
              ))}
              <th className="px-4 py-2.5 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {(data?.employees ?? []).map((employee) => {
              const entries = entriesByEmployee.get(employee.id) ?? [];
              const byDay = new Map<string, { minutes: number; open: boolean; flagged: boolean }>();
              for (const entry of entries) {
                const dayKey = dayKeyInTimeZone(new Date(entry.clock_in_at));
                const cell = byDay.get(dayKey) ?? { minutes: 0, open: false, flagged: false };
                cell.minutes += entryMinutes(entry, now);
                cell.open ||= !entry.clock_out_at;
                cell.flagged ||= entry.flagged;
                byDay.set(dayKey, cell);
              }
              const total = entries.reduce((sum, e) => sum + entryMinutes(e, now), 0);
              const isExpanded = expanded === employee.id;
              return (
                <FragmentRow
                  key={employee.id}
                  colSpan={days.length + 2}
                  expanded={isExpanded}
                  detail={entries.length > 0 ? entries.map(entryRow) : (
                    <p className="px-4 py-3 text-sm text-slate-400">No shifts this week.</p>
                  )}
                >
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : employee.id)}
                    className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-slate-900">{employee.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{employee.locationName ?? ""}</span>
                    </td>
                    {days.map((d) => {
                      const cell = byDay.get(d.date);
                      return (
                        <td key={d.date} className="px-2 py-2.5 text-right tabular-nums">
                          {cell ? (
                            <span className={cell.flagged ? "font-semibold text-amber-600" : "text-slate-700"}>
                              {decimalHours(cell.minutes)}
                              {cell.open && <span className="text-emerald-500"> ·</span>}
                            </span>
                          ) : (
                            <span className="text-slate-200">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">
                      {total > 0 ? formatDuration(total) : "—"}
                    </td>
                  </tr>
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Numbers are hours per day. A green dot means a shift is still running; amber means an entry
        needs review. Tap a row to see and fix individual shifts.
      </p>
    </div>
  );
}

// A table row plus an optional full-width detail row beneath it.
function FragmentRow({
  children,
  detail,
  expanded,
  colSpan,
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
  expanded: boolean;
  colSpan: number;
}) {
  return (
    <>
      {children}
      {expanded && (
        <tr className="border-b border-slate-100">
          <td colSpan={colSpan} className="bg-slate-50/60 p-0">
            <div className="divide-y divide-slate-100">{detail}</div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function HoursPanel() {
  return (
    <SWRProvider>
      <HoursPanelInner />
    </SWRProvider>
  );
}
