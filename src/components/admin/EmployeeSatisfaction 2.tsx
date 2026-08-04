"use client";

import { useEffect, useState } from "react";

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

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-400">
      {"★".repeat(n)}<span className="text-gray-200">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function weekLabel(weekOf: string): string {
  return new Date(weekOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function MiniBarChart({ data }: { data: { label: string; avg: number | null }[] }) {
  const max = 5;
  return (
    <div className="flex items-end gap-1.5 h-16">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex items-end justify-center" style={{ height: "48px" }}>
            {d.avg !== null ? (
              <div
                className="w-full rounded-t bg-amber-400"
                style={{ height: `${(d.avg / max) * 48}px`, minHeight: "2px" }}
                title={`${d.avg.toFixed(1)} avg`}
              />
            ) : (
              <div className="w-full rounded-t bg-sand-100" style={{ height: "4px" }} />
            )}
          </div>
          <span className="text-[9px] text-sand-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
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

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterEmployee) params.set("employee_id", filterEmployee);
    fetch(`/api/kpi/employees/surveys?${params}`)
      .then((r) => r.json())
      .then((d) => setSurveys(d.surveys ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filterEmployee]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async () => {
    if (!confirm("Send weekly survey to all active employees with a phone number?")) return;
    setSending(true);
    setSendResult("");
    try {
      const res = await fetch("/api/kpi/employees/surveys?action=send", { method: "POST" });
      const d = await res.json();
      setSendResult(`Sent: ${d.sent}, Skipped: ${d.skipped}${d.errors?.length ? ` — Errors: ${d.errors.join("; ")}` : ""}`);
      load();
    } catch {
      setSendResult("Failed to send surveys.");
    } finally {
      setSending(false);
    }
  };

  // Summary metrics
  const responded = surveys.filter((s) => s.responded_at !== null);
  const responseRate = surveys.length > 0 ? Math.round((responded.length / surveys.length) * 100) : 0;
  const avgScore = responded.length > 0
    ? responded.reduce((s, r) => s + (r.satisfaction_score ?? 0), 0) / responded.length
    : null;

  // Weekly trend — last 8 weeks
  const weekMap = new Map<string, number[]>();
  for (const s of responded) {
    const scores = weekMap.get(s.week_of) ?? [];
    if (s.satisfaction_score) scores.push(s.satisfaction_score);
    weekMap.set(s.week_of, scores);
  }
  const trendData = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, scores]) => ({
      label: new Date(week + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      avg: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    }));

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h2 className="text-xl font-semibold text-sand-900">Employee Satisfaction</h2>
        <div className="flex items-center gap-3">
          <select
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            className="text-sm border border-sand-200 rounded-lg px-3 py-2 bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {sending ? "Sending..." : "Send Weekly Survey"}
          </button>
        </div>
      </div>

      {sendResult && (
        <p className={`text-sm px-4 py-2 rounded-lg ${sendResult.includes("Error") || sendResult.includes("Failed") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {sendResult}
        </p>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-1">Avg Score</p>
          <p className="text-2xl font-bold text-sand-900">
            {avgScore !== null ? avgScore.toFixed(1) : "—"}
            <span className="text-base font-normal text-sand-400">/5</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-1">Response Rate</p>
          <p className="text-2xl font-bold text-sand-900">{responseRate}<span className="text-base font-normal text-sand-400">%</span></p>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-1">Total Responses</p>
          <p className="text-2xl font-bold text-sand-900">{responded.length}</p>
        </div>
      </div>

      {/* Weekly trend chart */}
      {trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-sand-200/60 p-5">
          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-4">Weekly Average Score</p>
          <MiniBarChart data={trendData} />
        </div>
      )}

      {/* Responses table */}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-sand-100">
          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Responses</p>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-sm text-sand-400">Loading...</p>
        ) : surveys.length === 0 ? (
          <p className="px-5 py-8 text-sm text-sand-400 text-center">No surveys sent yet.</p>
        ) : (
          <div className="divide-y divide-sand-50">
            {surveys.map((s) => {
              const name = s.employees?.name ?? "Unknown";
              const isExpanded = expanded === s.id;
              const hasText = s.highlights || s.complaints || s.suggestions;
              return (
                <div key={s.id}>
                  <div
                    className={`flex items-center gap-4 px-5 py-3 ${hasText ? "cursor-pointer hover:bg-sand-50/40" : ""}`}
                    onClick={() => hasText && setExpanded(isExpanded ? null : s.id)}
                  >
                    <div className="min-w-[120px]">
                      <p className="text-sm font-medium text-sand-900">{name}</p>
                      <p className="text-xs text-sand-400">{weekLabel(s.week_of)}</p>
                    </div>
                    <div className="flex-1">
                      {s.satisfaction_score ? (
                        <Stars n={s.satisfaction_score} />
                      ) : (
                        <span className="text-xs text-sand-300 italic">No response</span>
                      )}
                    </div>
                    {hasText && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                        className={`w-4 h-4 text-sand-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="px-5 pb-4 space-y-3 bg-sand-50/30">
                      {s.highlights && (
                        <div>
                          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-1">What went well</p>
                          <p className="text-sm text-sand-700 whitespace-pre-wrap">{s.highlights}</p>
                        </div>
                      )}
                      {s.complaints && (
                        <div>
                          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-1">Issues / Concerns</p>
                          <p className="text-sm text-sand-700 whitespace-pre-wrap">{s.complaints}</p>
                        </div>
                      )}
                      {s.suggestions && (
                        <div>
                          <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-1">To address</p>
                          <p className="text-sm text-sand-700 whitespace-pre-wrap">{s.suggestions}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
