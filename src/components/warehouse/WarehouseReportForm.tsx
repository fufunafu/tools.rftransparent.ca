"use client";

import { useCallback, useEffect, useState } from "react";
import { useNativeRuntime } from "@/components/NativeAppRuntime";
import { dayKeyInTimeZone } from "@/lib/time-clock";

interface Employee {
  id: string;
  name: string;
}

interface Report {
  id: string;
  report_date: string;
  boxes_built: number;
  orders_packed: number;
  walkin_pickup: number;
  notes: string | null;
  updated_at: string;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return typeof data.error === "string" ? data.error : fallback;
}

function numericValue(value: string): number | null {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000
    ? parsed
    : null;
}

const STORAGE_KEY = "warehouse_report_employee_id";

export default function WarehouseReportForm({
  employeeName,
  defaultEmployeeId,
}: {
  employeeName: string;
  defaultEmployeeId: string | null;
}) {
  const { connected } = useNativeRuntime();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>(defaultEmployeeId ?? "");
  const [date, setDate] = useState(() => dayKeyInTimeZone(new Date()));
  const [boxesBuilt, setBoxesBuilt] = useState("");
  const [ordersPacked, setOrdersPacked] = useState("");
  const [walkinPickup, setWalkinPickup] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [existingReport, setExistingReport] = useState<Report | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);

  // The warehouse floor shares one station, so the form asks who is reporting.
  // Signed-in warehouse staff start on their own name; the last choice is
  // remembered for the shared terminal.
  useEffect(() => {
    fetch("/api/warehouse/employees", { cache: "no-store" })
      .then((response) => response.json())
      .then((list: Employee[]) => {
        if (!Array.isArray(list)) return;
        setEmployees(list);
        setEmployeeId((current) => {
          if (current && list.some((e) => e.id === current)) return current;
          let stored: string | null = null;
          try {
            stored = window.localStorage.getItem(STORAGE_KEY);
          } catch {
            // Storage unavailable; fall through to the first entry.
          }
          if (stored && list.some((e) => e.id === stored)) return stored;
          return current;
        });
      })
      .catch(() => setError("Could not load the warehouse team list."));
  }, []);

  const loadExisting = useCallback(async () => {
    if (!date || !employeeId) return;
    setLoadingReport(true);
    setError("");
    try {
      const response = await fetch(
        `/api/warehouse/reports?employeeId=${encodeURIComponent(employeeId)}&from=${date}&to=${date}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response, "Could not load your report."));
      const reports: Report[] = await response.json();
      const report = reports[0] ?? null;
      setExistingReport(report);
      setBoxesBuilt(report ? String(report.boxes_built) : "");
      setOrdersPacked(report ? String(report.orders_packed) : "");
      setWalkinPickup(report ? String(report.walkin_pickup ?? 0) : "");
      setNotes(report?.notes ?? "");
    } catch (loadError) {
      setExistingReport(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load your report.");
    } finally {
      setLoadingReport(false);
    }
  }, [date, employeeId]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId) {
      setError("Pick whose report this is first.");
      return;
    }
    if (!connected || !navigator.onLine) {
      setError("Reports require an internet connection. Reconnect and try again.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    const counts = [
      numericValue(boxesBuilt),
      numericValue(ordersPacked),
      numericValue(walkinPickup),
    ];
    if (counts.some((value) => value === null)) {
      setError("Production counts must be whole numbers between 0 and 1,000,000.");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/warehouse/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          report_date: date,
          boxes_built: counts[0],
          orders_packed: counts[1],
          walkin_pickup: counts[2],
          notes: notes.trim() || null,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not save your report."));
      const saved: Report = await response.json();
      setExistingReport(saved);
      setSuccess(existingReport ? "Report updated." : "Report submitted.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your report.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="mx-auto max-w-lg">
      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
      >
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-600">Warehouse</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Daily report</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Report the day&rsquo;s production. You are signed in as {employeeName}.
          </p>
        </header>

        <label className="block text-sm font-semibold text-slate-700">
          Your name
          <select
            value={employeeId}
            required
            onChange={(event) => {
              const next = event.target.value;
              setEmployeeId(next);
              setSuccess("");
              try {
                if (next) window.localStorage.setItem(STORAGE_KEY, next);
              } catch {
                // Storage unavailable; the selection still applies.
              }
            }}
            className={`${fieldClass} mt-1.5`}
          >
            <option value="">Select your name...</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-semibold text-slate-700">
          Date
          <input
            type="date"
            value={date}
            required
            onChange={(event) => {
              setDate(event.target.value);
              setSuccess("");
            }}
            className={`${fieldClass} mt-1.5`}
          />
        </label>

        {!employeeId ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" role="status">
            Pick a name to load that person&rsquo;s report.
          </p>
        ) : loadingReport ? (
          <div className="h-16 animate-pulse rounded-2xl bg-slate-100" aria-label="Loading report" />
        ) : existingReport ? (
          <p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800" role="status">
            You already submitted this date. Saving will update your report from {new Date(existingReport.updated_at).toLocaleString()}.
          </p>
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" role="status">
            No report has been submitted for this date.
          </p>
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Production counts</legend>
          {[
            ["Boxes built", boxesBuilt, setBoxesBuilt],
            ["Orders packed", ordersPacked, setOrdersPacked],
            ["Walk-in and pick-up", walkinPickup, setWalkinPickup],
          ].map(([label, value, setter]) => (
            <label key={label as string} className="block text-sm font-semibold text-slate-700">
              {label as string}
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={value as string}
                onChange={(event) => (setter as (next: string) => void)(event.target.value)}
                placeholder="0"
                className={`${fieldClass} mt-1.5`}
              />
            </label>
          ))}
        </fieldset>

        <label className="block text-sm font-semibold text-slate-700">
          Notes <span className="font-normal text-slate-400">(optional)</span>
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Add any issue or context for today"
            className={`${fieldClass} mt-1.5 resize-y`}
          />
        </label>

        {!connected && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">
            You are offline. Nothing will be submitted until you reconnect and tap submit again.
          </p>
        )}
        {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" aria-live="assertive">{error}</p>}
        {success && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status" aria-live="polite">{success}</p>}

        <button
          type="submit"
          disabled={saving || (loadingReport && !!employeeId) || !connected || !employeeId}
          className="min-h-12 w-full rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white shadow-lg shadow-blue-600/20 transition active:scale-[0.99] disabled:opacity-50"
        >
          {saving ? "Saving..." : existingReport ? "Update my report" : "Submit my report"}
        </button>
      </form>
    </div>
  );
}
