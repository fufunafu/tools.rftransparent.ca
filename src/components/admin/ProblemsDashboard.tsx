"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  type ProblemTicket,
  PROBLEM_TYPES,
  typeLabel,
  typeColor,
} from "@/lib/problem-tickets";
import type { MonthlyTypeRow, YearlyRow } from "./ProblemsCharts";

const MonthlyByTypeChart = dynamic(
  () => import("./ProblemsCharts").then((m) => ({ default: m.MonthlyByTypeChart })),
  { ssr: false }
);
const YearComparisonChart = dynamic(
  () => import("./ProblemsCharts").then((m) => ({ default: m.YearComparisonChart })),
  { ssr: false }
);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface StoreOption {
  id: string;
  label: string;
}

type StatusFilter = "all" | "in_progress" | "resolved";

interface FormState {
  client_name: string;
  ticket_date: string;
  person: string;
  type: string;
  store: string;
  issue: string;
  status: "in_progress" | "resolved";
  resolution: string;
}

function todayToronto(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

function emptyForm(): FormState {
  return {
    client_name: "",
    ticket_date: todayToronto(),
    person: "",
    type: "other",
    store: "",
    issue: "",
    status: "in_progress",
    resolution: "",
  };
}

function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// "2026-03-14" -> { year: 2026, month: 2 } without Date/UTC pitfalls.
function parseISO(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

function daysToResolve(t: ProblemTicket): number | null {
  if (!t.resolved_at) return null;
  const resolved = t.resolved_at.slice(0, 10);
  const ms = new Date(resolved + "T12:00:00").getTime() - new Date(t.ticket_date + "T12:00:00").getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

export default function ProblemsDashboard({
  stores,
  canDelete,
}: {
  stores: StoreOption[];
  canDelete: boolean;
}) {
  const currentYear = useMemo(() => parseISO(todayToronto()).year, []);
  const [tickets, setTickets] = useState<ProblemTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(currentYear);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeForm = useCallback(() => {
    if (saving) return;
    setShowForm(false);
    setEditingId(null);
  }, [saving]);

  useEffect(() => {
    if (!showForm) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeForm();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showForm, closeForm]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/problems", { cache: "no-store" });
        if (!cancelled) {
          if (res.ok) {
            const json = await res.json();
            setTickets(json.tickets ?? []);
          } else {
            setError("Could not load tickets");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const years = useMemo(() => {
    const set = new Set<number>([currentYear]);
    for (const t of tickets) set.add(parseISO(t.ticket_date).year);
    return [...set].sort((a, b) => b - a);
  }, [tickets, currentYear]);

  const yearTickets = useMemo(
    () => tickets.filter((t) => parseISO(t.ticket_date).year === year),
    [tickets, year]
  );

  const filtered = useMemo(
    () =>
      yearTickets.filter(
        (t) =>
          (statusFilter === "all" || t.status === statusFilter) &&
          (typeFilter === "all" || t.type === typeFilter)
      ),
    [yearTickets, statusFilter, typeFilter]
  );

  const metrics = useMemo(() => {
    const openNow = tickets.filter((t) => t.status === "in_progress").length;
    const resolved = yearTickets.filter((t) => t.status === "resolved");
    const days = yearTickets.map(daysToResolve).filter((d): d is number => d !== null);
    const avgDays = days.length
      ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
      : null;
    const prevYearTotal = tickets.filter(
      (t) => parseISO(t.ticket_date).year === year - 1
    ).length;
    return {
      openNow,
      total: yearTickets.length,
      resolvedPct: yearTickets.length
        ? Math.round((resolved.length / yearTickets.length) * 100)
        : null,
      avgDays,
      prevYearTotal,
    };
  }, [tickets, yearTickets, year]);

  const monthlyByType = useMemo(() => {
    const rows: MonthlyTypeRow[] = MONTHS.map((m) => ({ month: m }));
    const present = new Set<string>();
    for (const t of yearTickets) {
      const { month } = parseISO(t.ticket_date);
      const key = PROBLEM_TYPES.some((p) => p.value === t.type) ? t.type : "other";
      rows[month][key] = ((rows[month][key] as number) ?? 0) + 1;
      present.add(key);
    }
    return { rows, presentTypes: [...present] };
  }, [yearTickets]);

  const yearComparison = useMemo(() => {
    const counts = new Map<number, number[]>();
    for (const t of tickets) {
      const { year: y, month } = parseISO(t.ticket_date);
      if (!counts.has(y)) counts.set(y, Array(12).fill(0));
      counts.get(y)![month] += 1;
    }
    if (!counts.has(currentYear)) counts.set(currentYear, Array(12).fill(0));
    const allYears = [...counts.keys()].sort((a, b) => b - a);
    const thisMonth = parseISO(todayToronto()).month;
    const rows: YearlyRow[] = MONTHS.map((m, i) => {
      const row: YearlyRow = { month: m };
      for (const y of allYears) {
        // Future months of the current year stay null so the line stops at
        // "now" instead of plunging to zero.
        row[String(y)] = y === currentYear && i > thisMonth ? null : counts.get(y)![i];
      }
      return row;
    });
    return { rows, years: allYears };
  }, [tickets, currentYear]);

  const openNew = useCallback(() => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
    setError(null);
  }, []);

  const openEdit = useCallback((t: ProblemTicket, status?: "resolved") => {
    setForm({
      client_name: t.client_name,
      ticket_date: t.ticket_date,
      person: t.person ?? "",
      type: t.type,
      store: t.store ?? "",
      issue: t.issue ?? "",
      status: status ?? t.status,
      resolution: t.resolution ?? "",
    });
    setEditingId(t.id);
    setShowForm(true);
    setError(null);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/problems", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Save failed");
        return;
      }
      const ticket: ProblemTicket = json.ticket;
      setTickets((prev) =>
        editingId ? prev.map((t) => (t.id === editingId ? ticket : t)) : [ticket, ...prev]
      );
      setShowForm(false);
      setEditingId(null);
      // Jump the year filter to the saved ticket so it doesn't silently
      // disappear behind a different year.
      setYear(parseISO(ticket.ticket_date).year);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen(t: ProblemTicket) {
    const res = await fetch("/api/problems", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, status: "in_progress" }),
    });
    if (res.ok) {
      const { ticket } = await res.json();
      setTickets((prev) => prev.map((p) => (p.id === t.id ? ticket : p)));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this ticket? This can't be undone.")) return;
    const res = await fetch(`/api/problems?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setTickets((prev) => prev.filter((t) => t.id !== id));
    } else {
      const json = await res.json().catch(() => null);
      setError(json?.error || "Delete failed");
    }
  }

  const storeLabel = (id: string | null) =>
    stores.find((s) => s.id === id)?.label ?? null;

  const inputClass =
    "w-full rounded-lg border border-sand-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
  const labelClass = "block text-xs font-medium text-sand-500 mb-1";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Problem Tickets</h1>
          <p className="text-sm text-sand-500 mt-1">
            Client issues — delivery errors, broken glass, wrong orders — tracked so we
            can see whether we&apos;re improving year over year.
          </p>
        </div>
        <button
          onClick={openNew}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New ticket
        </button>
      </div>

      {error && !showForm && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Add / edit form */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <form
            onSubmit={handleSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="problem-ticket-form-title"
            className="max-h-[calc(100vh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-lg border border-sand-200 bg-white shadow-xl sm:max-h-[calc(100vh-3rem)]"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-sand-200 bg-white px-5 py-4">
              <h2 id="problem-ticket-form-title" className="text-base font-semibold text-sand-900">
                {editingId ? "Edit ticket" : "New ticket"}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close ticket editor"
                title="Close"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sand-400 hover:bg-sand-100 hover:text-sand-700 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
                  <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            {error && (
              <div role="alert" className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <label className={labelClass}>Client name *</label>
              <input
                className={inputClass}
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                placeholder="e.g. David Hugh"
                autoFocus
                required
              />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input
                type="date"
                className={inputClass}
                value={form.ticket_date}
                onChange={(e) => setForm((f) => ({ ...f, ticket_date: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select
                className={inputClass}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {PROBLEM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Store</label>
              <select
                className={inputClass}
                value={form.store}
                onChange={(e) => setForm((f) => ({ ...f, store: e.target.value }))}
              >
                <option value="">—</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className={labelClass}>Person handling it</label>
              <input
                className={inputClass}
                value={form.person}
                onChange={(e) => setForm((f) => ({ ...f, person: e.target.value }))}
                placeholder="e.g. Shanaz, Marisa"
              />
            </div>
            {editingId && (
              <div>
                <label className={labelClass}>Status</label>
                <select
                  className={inputClass}
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      status: e.target.value as FormState["status"],
                    }))
                  }
                >
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2 lg:col-span-5">
              <label className={labelClass}>What happened / next step</label>
              <textarea
                className={`${inputClass} min-h-[70px]`}
                value={form.issue}
                onChange={(e) => setForm((f) => ({ ...f, issue: e.target.value }))}
                placeholder="Describe the problem and what needs to happen next"
              />
            </div>
            {editingId && (
              <div className="sm:col-span-2 lg:col-span-5">
                <label className={labelClass}>Closing of the ticket</label>
                <textarea
                  className={`${inputClass} min-h-[70px]`}
                  value={form.resolution}
                  onChange={(e) => setForm((f) => ({ ...f, resolution: e.target.value }))}
                  placeholder="How it was resolved"
                />
              </div>
            )}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-sand-200 bg-white px-5 py-3">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-sand-600 hover:bg-sand-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.client_name.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Save changes" : "Add ticket"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-sand-200 p-5">
          <div className="text-xs font-medium text-sand-500">Open now</div>
          <div className="mt-1 text-2xl font-bold text-sand-900">{metrics.openNow}</div>
          <div className="text-xs text-sand-400 mt-1">all years, still in progress</div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200 p-5">
          <div className="text-xs font-medium text-sand-500">Tickets in {year}</div>
          <div className="mt-1 text-2xl font-bold text-sand-900">{metrics.total}</div>
          <div className="text-xs text-sand-400 mt-1">
            {year - 1}: {metrics.prevYearTotal}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200 p-5">
          <div className="text-xs font-medium text-sand-500">Resolved</div>
          <div className="mt-1 text-2xl font-bold text-sand-900">
            {metrics.resolvedPct === null ? "—" : `${metrics.resolvedPct}%`}
          </div>
          <div className="text-xs text-sand-400 mt-1">of {year} tickets</div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200 p-5">
          <div className="text-xs font-medium text-sand-500">Avg days to resolve</div>
          <div className="mt-1 text-2xl font-bold text-sand-900">
            {metrics.avgDays === null ? "—" : metrics.avgDays}
          </div>
          <div className="text-xs text-sand-400 mt-1">{year} resolved tickets</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-sand-200 p-5">
          <h2 className="text-sm font-semibold text-sand-900 mb-3">
            Tickets by month — {year}, by type
          </h2>
          <div className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-sm text-sand-400">
                Loading…
              </div>
            ) : (
              <MonthlyByTypeChart
                data={monthlyByType.rows}
                presentTypes={monthlyByType.presentTypes}
              />
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200 p-5">
          <h2 className="text-sm font-semibold text-sand-900 mb-3">
            Year over year — total tickets per month
          </h2>
          <div className="h-64">
            {loading ? (
              <div className="h-full flex items-center justify-center text-sm text-sand-400">
                Loading…
              </div>
            ) : (
              <YearComparisonChart data={yearComparison.rows} years={yearComparison.years} />
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-sand-200 bg-white p-0.5">
          {(
            [
              ["all", "All"],
              ["in_progress", "In progress"],
              ["resolved", "Resolved"],
            ] as [StatusFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                statusFilter === value
                  ? "bg-blue-50 text-blue-600"
                  : "text-sand-500 hover:text-sand-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="all">All types</option>
          {PROBLEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-sm text-sand-400 ml-auto">
          {filtered.length} ticket{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-sand-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sand-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sand-400 text-sm">
            No tickets match — add one with “New ticket”.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs text-sand-500">
                <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Type</th>
                <th className="px-4 py-3 font-medium">Person</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-medium min-w-[220px]">What happened / next step</th>
                <th className="px-4 py-3 font-medium min-w-[220px]">Closing of the ticket</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-sand-100 last:border-0 align-top hover:bg-sand-50/60">
                  <td className="px-4 py-3 whitespace-nowrap text-sand-500">
                    {formatDate(t.ticket_date)}
                  </td>
                  <td className="px-4 py-3 font-medium text-sand-900">
                    {t.client_name}
                    {t.store && storeLabel(t.store) && (
                      <div className="text-xs font-normal text-sand-400">
                        {storeLabel(t.store)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-sand-700">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: typeColor(t.type) }}
                      />
                      {typeLabel(t.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sand-600">{t.person || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {t.status === "resolved" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        Resolved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        In progress
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sand-600 whitespace-pre-wrap">
                    {t.issue || "—"}
                  </td>
                  <td className="px-4 py-3 text-sand-600 whitespace-pre-wrap">
                    {t.resolution || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-1">
                      {t.status === "in_progress" ? (
                        <button
                          onClick={() => openEdit(t, "resolved")}
                          className="rounded-md px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                          title="Mark resolved (opens the form so you can write the closing note)"
                        >
                          Resolve
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReopen(t)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-sand-500 hover:bg-sand-100"
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(t)}
                        className="rounded-md p-1.5 text-sand-400 hover:text-sand-600 hover:bg-sand-100"
                        title="Edit"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="rounded-md p-1.5 text-sand-400 hover:text-red-600 hover:bg-red-50"
                          title="Delete"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
