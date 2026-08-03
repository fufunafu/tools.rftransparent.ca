"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

interface Survey {
  id: string;
  employee_id: string;
  week_of: string;
  sent_at: string;
  responded_at: string | null;
  satisfaction_score: number | null;
  highlights: string | null;
  complaints: string | null;
  suggestions: string | null;
  employees: { name: string } | null;
}

interface EmployeeStub {
  id: string;
  name: string;
}

function PulseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2-5 4 10 2.25-5H21" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 5 16 7-16 7 2.5-7L4 5Z" />
      <path strokeLinecap="round" d="M6.5 12H14" />
    </svg>
  );
}

function Stars({ score }: { score: number }) {
  return (
    <span aria-label={`${score} out of 5`} className="whitespace-nowrap text-sm tracking-[0.08em] text-amber-400">
      <span aria-hidden="true">{"★".repeat(score)}</span>
      <span aria-hidden="true" className="text-slate-200">{"★".repeat(5 - score)}</span>
    </span>
  );
}

function weekLabel(weekOf: string): string {
  return new Date(weekOf + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || "?").toUpperCase();
}

function Metric({ label, value, suffix, note, accent }: { label: string; value: string | number; suffix?: string; note: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className={`h-2 w-2 rounded-full ${accent}`} aria-hidden="true" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        {value}<span className="ml-0.5 text-base font-medium text-slate-400">{suffix}</span>
      </p>
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </div>
  );
}

function MiniBarChart({ data }: { data: { label: string; avg: number | null }[] }) {
  return (
    <div className="flex h-40 items-end gap-2 sm:gap-3" aria-label="Weekly average satisfaction scores">
      {data.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className="flex h-28 w-full items-end justify-center rounded-lg bg-slate-50 px-1 pt-2">
            {item.avg !== null ? (
              <div
                className="relative w-full max-w-12 rounded-t-md bg-gradient-to-t from-amber-500 to-amber-300 transition-all"
                style={{ height: `${Math.max((item.avg / 5) * 104, 4)}px` }}
                title={`${item.avg.toFixed(1)} average`}
              >
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-slate-500">
                  {item.avg.toFixed(1)}
                </span>
              </div>
            ) : (
              <div className="h-1 w-full max-w-12 rounded-t bg-slate-200" />
            )}
          </div>
          <span className="w-full truncate text-center text-[9px] text-slate-400 sm:text-[10px]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ResponseDetail({ label, children, tone }: { label: string; children: ReactNode; tone: "green" | "amber" | "blue" }) {
  const colors = {
    green: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
    amber: "border-amber-200 bg-amber-50/70 text-amber-800",
    blue: "border-blue-200 bg-blue-50/70 text-blue-800",
  }[tone];

  return (
    <div className={`rounded-xl border p-3.5 ${colors}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-70">{label}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5">{children}</p>
    </div>
  );
}

export default function EmployeeSatisfaction({ employees }: { employees: EmployeeStub[] }) {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterEmployee) params.set("employee_id", filterEmployee);
    fetch(`/api/kpi/employees/surveys?${params}`)
      .then((response) => response.json())
      .then((data) => setSurveys(data.surveys ?? []))
      .finally(() => setLoading(false));
  }, [filterEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSend = async () => {
    if (!confirm("Send the weekly survey to all active employees with a phone number?")) return;
    setSending(true);
    setSendResult("");
    try {
      const response = await fetch("/api/kpi/employees/surveys?action=send", { method: "POST" });
      const data = await response.json();
      const errors = data.errors?.length ? ` Errors: ${data.errors.join("; ")}` : "";
      setSendResult(`Sent: ${data.sent}. Skipped: ${data.skipped}.${errors}`);
      load();
    } catch {
      setSendResult("Failed to send surveys.");
    } finally {
      setSending(false);
    }
  };

  const responded = surveys.filter((survey) => survey.responded_at !== null);
  const responseRate = surveys.length > 0 ? Math.round((responded.length / surveys.length) * 100) : 0;
  const avgScore = responded.length > 0
    ? responded.reduce((sum, survey) => sum + (survey.satisfaction_score ?? 0), 0) / responded.length
    : null;

  const weekMap = new Map<string, number[]>();
  for (const survey of responded) {
    const scores = weekMap.get(survey.week_of) ?? [];
    if (survey.satisfaction_score) scores.push(survey.satisfaction_score);
    weekMap.set(survey.week_of, scores);
  }
  const trendData = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, scores]) => ({
      label: new Date(week + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      avg: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    }));

  const sendFailed = sendResult.includes("Errors:") || sendResult.includes("Failed");

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <PulseIcon />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-950">Team satisfaction</h2>
            <p className="mt-1 max-w-xl text-sm leading-5 text-slate-500">Send a brief weekly check-in and turn responses into clear follow-up actions.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label>
            <span className="sr-only">Filter by employee</span>
            <select
              value={filterEmployee}
              onChange={(event) => setFilterEmployee(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:w-52"
            >
              <option value="">All employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <SendIcon />
            {sending ? "Sending..." : "Send weekly survey"}
          </button>
        </div>
      </section>

      {sendResult && (
        <p role={sendFailed ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${sendFailed ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {sendResult}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Average score" value={avgScore !== null ? avgScore.toFixed(1) : "–"} suffix="/5" note="Across received responses" accent="bg-amber-500" />
        <Metric label="Response rate" value={responseRate} suffix="%" note={`${responded.length} of ${surveys.length} surveys`} accent="bg-blue-500" />
        <Metric label="Total responses" value={responded.length} note="In the current view" accent="bg-emerald-500" />
      </div>

      {trendData.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-slate-900">Weekly average</h3>
            <p className="mt-0.5 text-xs text-slate-400">Satisfaction score over the last eight reporting weeks</p>
          </div>
          <MiniBarChart data={trendData} />
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Survey history</h3>
          <p className="mt-0.5 text-xs text-slate-400">Review scores, highlights, concerns, and suggestions.</p>
        </div>
        {loading ? (
          <div className="space-y-3 px-5 py-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className="h-9 w-9 animate-pulse rounded-xl bg-slate-100" />
                <div className="flex-1">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
                  <div className="mt-1.5 h-3 w-24 animate-pulse rounded bg-slate-50" />
                </div>
              </div>
            ))}
          </div>
        ) : surveys.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><PulseIcon /></span>
            <p className="mt-3 text-sm font-medium text-slate-600">No surveys in this view</p>
            <p className="mt-1 text-xs text-slate-400">Send a weekly survey to start collecting feedback.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {surveys.map((survey) => {
              const name = survey.employees?.name ?? "Unknown employee";
              const isExpanded = expanded === survey.id;
              const hasText = Boolean(survey.highlights || survey.complaints || survey.suggestions);
              return (
                <div key={survey.id}>
                  <button
                    type="button"
                    onClick={() => hasText && setExpanded(isExpanded ? null : survey.id)}
                    aria-expanded={hasText ? isExpanded : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5 ${hasText ? "transition hover:bg-slate-50" : "cursor-default"}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[11px] font-semibold text-slate-600" aria-hidden="true">
                      {initials(name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{name}</span>
                      <span className="mt-0.5 block text-xs text-slate-400">Week of {weekLabel(survey.week_of)}</span>
                    </span>
                    <span className="shrink-0">
                      {survey.satisfaction_score ? <Stars score={survey.satisfaction_score} /> : <span className="text-xs italic text-slate-300">No response</span>}
                    </span>
                    {hasText && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                      </svg>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="grid gap-3 bg-slate-50/60 px-4 pb-4 pt-1 sm:grid-cols-3 sm:px-5">
                      {survey.highlights && <ResponseDetail label="What went well" tone="green">{survey.highlights}</ResponseDetail>}
                      {survey.complaints && <ResponseDetail label="Issues or concerns" tone="amber">{survey.complaints}</ResponseDetail>}
                      {survey.suggestions && <ResponseDetail label="To address" tone="blue">{survey.suggestions}</ResponseDetail>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
