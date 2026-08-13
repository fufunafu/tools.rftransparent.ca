"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MetricAggregate, SurveyPrivacyModel, SurveyType } from "@/lib/survey-program";

interface AnswerRow {
  metric_key: string;
  question_text_snapshot: string;
  response_type: string;
  numeric_value: number | null;
  text_value: string | null;
  boolean_value: boolean | null;
  choice_value: string | null;
}

interface CampaignReport {
  id: string;
  name: string;
  type: SurveyType;
  privacyModel: SurveyPrivacyModel;
  status: string;
  sentAt: string | null;
  closesAt: string | null;
  delivery: {
    audience: number;
    sent: number;
    delivered: number;
    opened: number;
    completed: number;
    deliveryRate: number | null;
    responseRate: number | null;
  };
  overallSuppressed: boolean;
  metrics: Array<{ metricKey: string; prompt: string; aggregate: MetricAggregate }>;
  groups: Array<{
    kind: "department" | "location";
    label: string;
    responseCount: number;
    suppressed: boolean;
    metrics: Array<{ metricKey: string; aggregate: MetricAggregate }> | null;
  }>;
  responses: Array<{
    responseId: string;
    employeeId: string | null;
    employeeName: string | null;
    submittedAt: string;
    answers: AnswerRow[];
  }> | null;
}

interface SurveyAction {
  id: string;
  campaign_id: string | null;
  kind: "private_review" | "team_action" | "employee_update";
  title: string;
  issue: string | null;
  owner_name: string | null;
  due_at: string | null;
  status: "open" | "acknowledged" | "in_progress" | "completed" | "cancelled";
  resolution: string | null;
  published_at: string | null;
  created_at: string;
}

interface DashboardReport {
  campaigns: CampaignReport[];
  restrictedCampaigns: CampaignReport[];
  fourWeekTrend: Array<{ campaignId: string; name: string; sentAt: string | null; median: number | null; responseRate: number | null }>;
  themes: Array<{ theme: string; mentions: number }>;
  requestedFollowUps: number;
  actions: SurveyAction[];
  actionMetrics: { open: number; overdue: number; completed: number; averageCompletionHours: number | null; followUpRequests: number; acknowledgedOnTime: number; acknowledgementRate: number | null; lastEmployeeUpdateAt: string | null; employeeUpdateDue: boolean };
  alerts: Array<{ kind: string; message: string; campaignId?: string; actionId?: string }>;
  error?: string;
}

interface EmployeeStub {
  id: string;
  name: string;
  department?: string | null;
  location_id?: string | null;
}

const TYPE_LABELS: Record<SurveyType, string> = {
  weekly: "Weekly pulse",
  quarterly: "Quarterly engagement",
  onboarding: "Onboarding",
  exit: "Exit",
  targeted: "Targeted",
};

const ACTION_LABELS: Record<SurveyAction["status"], string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "Not set";
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </div>
  );
}

function Distribution({ aggregate }: { aggregate: MetricAggregate }) {
  const maximum = Math.max(1, ...Object.values(aggregate.distribution));
  return (
    <div className="mt-2 flex h-10 items-end gap-1" aria-label="Answer distribution">
      {[1, 2, 3, 4, 5].map((value) => {
        const count = aggregate.distribution[String(value)] ?? 0;
        return (
          <div key={value} className="flex min-w-5 flex-1 flex-col items-center gap-1">
            <span className="w-full rounded-t bg-blue-400" style={{ height: `${Math.max(2, (count / maximum) * 24)}px` }} title={`${count} selected ${value}`} />
            <span className="text-[9px] text-slate-400">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function CampaignDetail({ campaign }: { campaign: CampaignReport }) {
  const [showResponses, setShowResponses] = useState(false);
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
      {campaign.overallSuppressed && (
        <p className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-xs leading-5 text-violet-800">
          Results are suppressed until at least five people respond.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {campaign.metrics.map((metric) => (
          <div key={metric.metricKey} className="rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs font-medium leading-4 text-slate-600">{metric.prompt}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xl font-semibold text-slate-950">{metric.aggregate.median ?? "–"}</span>
              <span className="text-[11px] text-slate-400">median · {metric.aggregate.count} answers</span>
            </div>
            <Distribution aggregate={metric.aggregate} />
          </div>
        ))}
      </div>

      {campaign.groups.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Group</th><th className="px-3 py-2">Responses</th><th className="px-3 py-2">Result</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {campaign.groups.map((group) => (
                <tr key={`${group.kind}:${group.label}`}>
                  <td className="px-3 py-2 font-medium text-slate-700">{group.label}<span className="ml-1 text-slate-400">({group.kind})</span></td>
                  <td className="px-3 py-2 text-slate-500">{group.responseCount}</td>
                  <td className="px-3 py-2 text-slate-500">{group.suppressed ? "Suppressed: fewer than 5 responses" : `${group.metrics?.[0]?.aggregate.median ?? "–"} median on first measure`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {campaign.responses === null ? (
        <p className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-xs leading-5 text-violet-800">
          Individual answers are unavailable. This campaign is reported only as a confidential aggregate.
        </p>
      ) : campaign.responses.length > 0 ? (
        <div className="mt-4">
          <button type="button" onClick={() => setShowResponses((value) => !value)} className="text-xs font-semibold text-blue-700 hover:text-blue-800">
            {showResponses ? "Hide" : "Review"} {campaign.responses.length} named response{campaign.responses.length === 1 ? "" : "s"}
          </button>
          {showResponses && (
            <div className="mt-3 space-y-3">
              {campaign.responses.map((response) => (
                <article key={response.responseId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-900">{response.employeeName ?? "Restricted response"}</h4>
                    <span className="text-[11px] text-slate-400">{formatDate(response.submittedAt)}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {response.answers.map((answer) => {
                      const display = answer.numeric_value ?? answer.text_value ?? answer.choice_value ?? (answer.boolean_value === null ? null : answer.boolean_value ? "Yes" : "No");
                      if (display === null || display === "") return null;
                      return (
                        <div key={answer.metric_key} className="rounded-lg bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{answer.question_text_snapshot}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{String(display)}</p>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function EmployeeSatisfaction({ employees }: { employees: EmployeeStub[] }) {
  const [data, setData] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [showTargeted, setShowTargeted] = useState(false);
  const [showActionForm, setShowActionForm] = useState<"team_action" | "employee_update" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/kpi/employees/surveys", { cache: "no-store" });
      const payload = await response.json() as DashboardReport;
      if (!response.ok) throw new Error(payload.error ?? "Could not load survey reporting");
      setData(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load survey reporting");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sendWeekly = async () => {
    if (!confirm("Create and send the survey due for the current survey week now? Existing recipients will be skipped.")) return;
    setWorking(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/kpi/employees/surveys?action=send", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Survey send failed");
      setStatus(`Sent ${result.sent}. Skipped ${result.skipped}.`);
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Survey send failed");
    } finally { setWorking(false); }
  };

  const updateAction = async (action: SurveyAction, nextStatus: SurveyAction["status"]) => {
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/kpi/employees/surveys/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id, status: nextStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Action update failed");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action update failed");
    } finally { setWorking(false); }
  };

  const publishUpdate = async (action: SurveyAction) => {
    if (!confirm("Send this ‘You said, we did’ update to every active employee with a phone number?")) return;
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/kpi/employees/surveys/actions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join("; ") || result.error || "Publish failed");
      setStatus(`Employee update sent to ${result.sent} people.`);
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Publish failed");
    } finally { setWorking(false); }
  };

  const latest = data?.campaigns[0];
  const departments = useMemo(() => [...new Set(employees.map((employee) => employee.department).filter((value): value is string => Boolean(value)))].sort(), [employees]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600">Management only</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">Employee survey program</h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-500">Monitor delivery, trends, follow-up requests, confidential aggregates, and the actions management takes in response.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowTargeted(true)} className="h-10 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">New targeted survey</button>
            <button type="button" onClick={sendWeekly} disabled={working} className="h-10 rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Send current survey now</button>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {status && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</p>}

      {loading && !data ? <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">Loading survey program…</div> : data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Latest response rate" value={latest?.delivery.responseRate === null || !latest ? "–" : `${latest.delivery.responseRate}%`} note={latest ? `Target above ${latest.type === "quarterly" ? 75 : 65}% · ${latest.name}` : "No campaigns yet"} />
            <MetricCard label="Latest delivery" value={latest?.delivery.deliveryRate === null || !latest ? "–" : `${latest.delivery.deliveryRate}%`} note={`Target at least 95% · ${latest?.delivery.delivered ?? 0} of ${latest?.delivery.sent ?? 0}`} />
            <MetricCard label="Follow-up acknowledgement" value={data.actionMetrics.acknowledgementRate === null ? "–" : `${data.actionMetrics.acknowledgementRate}%`} note={`${data.actionMetrics.acknowledgedOnTime} of ${data.actionMetrics.followUpRequests} within two business days`} />
            <MetricCard label="Open actions" value={data.actionMetrics.open} note={`${data.actionMetrics.overdue} overdue · ${data.actionMetrics.completed} completed`} />
          </div>

          {data.alerts.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">Needs attention</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-amber-800">{data.alerts.map((alert, index) => <li key={`${alert.kind}:${alert.actionId ?? alert.campaignId ?? index}`}>• {alert.message}</li>)}</ul>
            </section>
          )}

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">Campaign reporting</h3>
                <p className="mt-0.5 text-xs text-slate-400">Sent, delivered, opened, completion, medians, distributions, and privacy-safe group trends.</p>
              </div>
              {data.campaigns.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">No campaigns yet.</p> : (
                <div className="divide-y divide-slate-100">
                  {data.campaigns.map((campaign) => {
                    const expanded = expandedCampaign === campaign.id;
                    return (
                      <div key={campaign.id}>
                        <button type="button" onClick={() => setExpandedCampaign(expanded ? null : campaign.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-left transition hover:bg-slate-50 sm:px-5">
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{campaign.name}</span><span className="mt-0.5 block text-[11px] text-slate-400">{TYPE_LABELS[campaign.type]} · {formatDate(campaign.sentAt)} · {campaign.privacyModel.replaceAll("_", " ")}</span></span>
                          <span className="text-xs text-slate-500">{campaign.delivery.completed}/{campaign.delivery.audience} complete</span>
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{campaign.delivery.responseRate ?? 0}%</span>
                          <span className="text-xs text-slate-400">{expanded ? "▲" : "▼"}</span>
                        </button>
                        {expanded && <CampaignDetail campaign={campaign} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Four-week trend</h3>
                <div className="mt-4 space-y-3">
                  {data.fourWeekTrend.length === 0 ? <p className="text-xs text-slate-400">No weekly trend yet.</p> : data.fourWeekTrend.map((point) => (
                    <div key={point.campaignId} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-slate-500">{formatDate(point.sentAt)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${((point.median ?? 0) / 5) * 100}%` }} /></div>
                      <span className="w-16 text-right text-xs font-semibold text-slate-700">{point.median ?? "–"}/5</span>
                      <span className="w-10 text-right text-[11px] text-slate-400">{point.responseRate ?? 0}%</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Recurring feedback themes</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.themes.length === 0 ? <p className="text-xs text-slate-400">Themes appear after a word is mentioned in at least two responses.</p> : data.themes.map((theme) => <span key={theme.theme} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{theme.theme} · {theme.mentions}</span>)}
                </div>
              </section>
            </div>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-slate-900">Management actions</h3><p className="mt-0.5 text-xs text-slate-400">Private reviews, owned team actions, and monthly “You said, we did” updates. {data.actionMetrics.employeeUpdateDue ? "The next employee update is due." : `Last update published ${formatDate(data.actionMetrics.lastEmployeeUpdateAt)}.`}</p></div>
              <div className="flex gap-2"><button type="button" onClick={() => setShowActionForm("team_action")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Add team action</button><button type="button" onClick={() => setShowActionForm("employee_update")} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Draft employee update</button></div>
            </div>
            <div className="mt-4 divide-y divide-slate-100">
              {data.actions.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No actions yet.</p> : data.actions.map((action) => (
                <article key={action.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-slate-900">{action.title}</h4><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{action.kind.replaceAll("_", " ")}</span></div>{action.issue && <p className="mt-1 text-xs leading-5 text-slate-500">{action.issue}</p>} {action.resolution && <p className="mt-1 text-xs leading-5 text-emerald-700">We did: {action.resolution}</p>}<p className="mt-1 text-[11px] text-slate-400">{action.owner_name ? `Owner: ${action.owner_name}` : "No owner"} · Due {formatDate(action.due_at)} · {ACTION_LABELS[action.status]}</p></div>
                  <div className="flex shrink-0 gap-2">
                    {action.status === "open" && <button disabled={working} onClick={() => updateAction(action, "acknowledged")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600">Acknowledge</button>}
                    {["acknowledged", "in_progress"].includes(action.status) && <button disabled={working} onClick={() => updateAction(action, "completed")} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">Complete</button>}
                    {action.kind === "employee_update" && !action.published_at && <button disabled={working} onClick={() => publishUpdate(action)} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white">Publish</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {data.restrictedCampaigns.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/40 shadow-sm">
              <div className="border-b border-violet-100 px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">Restricted access</p>
                <h3 className="mt-1 text-sm font-semibold text-violet-950">Voluntary exit surveys</h3>
                <p className="mt-0.5 text-xs text-violet-700/70">Kept separate from regular weekly reporting and visible only to the configured small management group.</p>
              </div>
              <div className="divide-y divide-violet-100">
                {data.restrictedCampaigns.map((campaign) => {
                  const expanded = expandedCampaign === campaign.id;
                  return <div key={campaign.id}><button type="button" onClick={() => setExpandedCampaign(expanded ? null : campaign.id)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-violet-50"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-violet-950">{campaign.name}</span><span className="text-[11px] text-violet-600">{campaign.delivery.completed}/{campaign.delivery.audience} completed</span></span><span className="text-xs text-violet-600">{expanded ? "▲" : "▼"}</span></button>{expanded && <CampaignDetail campaign={campaign} />}</div>;
                })}
              </div>
            </section>
          )}
        </>
      )}

      {showTargeted && <TargetedCampaignDialog departments={departments} employees={employees} onClose={() => setShowTargeted(false)} onCreated={async (message) => { setStatus(message); setShowTargeted(false); await load(); }} />}
      {showActionForm && <ActionDialog kind={showActionForm} employees={employees} campaigns={data?.campaigns ?? []} onClose={() => setShowActionForm(null)} onCreated={async () => { setShowActionForm(null); await load(); }} />}
    </div>
  );
}

function DialogShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-base font-semibold text-slate-950">{title}</h3><button type="button" onClick={onClose} className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100">×</button></div>{children}</div></div>;
}

const fieldClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function TargetedCampaignDialog({ departments, employees, onClose, onCreated }: { departments: string[]; employees: EmployeeStub[]; onClose: () => void; onCreated: (message: string) => void }) {
  const [form, setForm] = useState({ name: "", purpose: "", decision_supported: "", department: "", employee_id: "" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const response = await fetch("/api/kpi/employees/surveys?action=targeted", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, employee_ids: form.employee_id ? [form.employee_id] : undefined }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Campaign creation failed"); onCreated(`Targeted survey sent to ${result.sent} people.`); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Campaign creation failed"); } finally { setSaving(false); } };
  return <DialogShell title="New targeted post-change survey" onClose={onClose}><form onSubmit={submit} className="mt-5 space-y-4"><p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">Use this only after a meaningful event, such as new software, a process or schedule change, restructuring, or training.</p><input className={fieldClass} placeholder="Campaign name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><textarea className={`${fieldClass} h-auto py-3`} rows={2} placeholder="What event are you evaluating?" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} required /><textarea className={`${fieldClass} h-auto py-3`} rows={2} placeholder="What specific decision will the answers support?" value={form.decision_supported} onChange={(event) => setForm({ ...form, decision_supported: event.target.value })} required /><div className="grid gap-3 sm:grid-cols-2"><select className={fieldClass} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value, employee_id: "" })}><option value="">All departments</option>{departments.map((department) => <option key={department} value={department}>{department.replaceAll("_", " ")}</option>)}</select><select className={fieldClass} value={form.employee_id} onChange={(event) => setForm({ ...form, employee_id: event.target.value, department: "" })}><option value="">All selected employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>{error && <p className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Sending…" : "Create and send"}</button></div></form></DialogShell>;
}

function ActionDialog({ kind, employees, campaigns, onClose, onCreated }: { kind: "team_action" | "employee_update"; employees: EmployeeStub[]; campaigns: CampaignReport[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", issue: "", owner_name: "", owner_employee_id: "", due_at: "", resolution: "", campaign_id: "" }); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const response = await fetch("/api/kpi/employees/surveys/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, kind }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not save action"); onCreated(); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save action"); } finally { setSaving(false); } };
  return <DialogShell title={kind === "team_action" ? "Add team-wide action" : "Draft ‘You said, we did’ update"} onClose={onClose}><form onSubmit={submit} className="mt-5 space-y-4"><input className={fieldClass} placeholder={kind === "team_action" ? "Action title" : "What employees said"} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /><textarea className={`${fieldClass} h-auto py-3`} rows={2} placeholder="Issue or context" value={form.issue} onChange={(event) => setForm({ ...form, issue: event.target.value })} />{kind === "team_action" ? <div className="grid gap-3 sm:grid-cols-2"><select className={fieldClass} value={form.owner_employee_id} onChange={(event) => { const employee = employees.find((item) => item.id === event.target.value); setForm({ ...form, owner_employee_id: event.target.value, owner_name: employee?.name ?? "" }); }} required><option value="">Choose owner</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><input type="date" className={fieldClass} value={form.due_at} onChange={(event) => setForm({ ...form, due_at: event.target.value })} required /></div> : <textarea className={`${fieldClass} h-auto py-3`} rows={3} placeholder="What management did or will do" value={form.resolution} onChange={(event) => setForm({ ...form, resolution: event.target.value })} required />}<select className={fieldClass} value={form.campaign_id} onChange={(event) => setForm({ ...form, campaign_id: event.target.value })}><option value="">No linked campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>{error && <p className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></div></form></DialogShell>;
}
