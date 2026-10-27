"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { CRM_LABELS, CRM_TYPES, type CrmPage, type CrmRecord, type CrmStatus, type CrmType } from "@/lib/crm/types";

const INPUT = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100";
const BUTTON = "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const PRIMARY = "min-h-11 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50";
const ACTIVITIES: CrmType[] = ["notes", "calls", "meetings", "emails", "tasks"];
const SINGLE: Record<CrmType, string> = { contacts: "Contact", companies: "Company", deals: "Deal", tickets: "Ticket", calls: "Call", meetings: "Meeting", emails: "Email", notes: "Note", tasks: "Task" };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  let data;
  try { data = await response.json(); } catch { throw new Error("Unable to reach Tools. Please try again."); }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function localInput(value = new Date()): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "No date";
}
function SourceBadge({ source }: { source: CrmRecord["source"] }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${source === "tools" ? "bg-emerald-50 text-emerald-800" : "bg-orange-50 text-orange-800"}`}>{source === "tools" ? "Tools" : "HubSpot"}</span>;
}
function ErrorMessage({ error }: { error?: Error | null }) {
  return error ? <p role="alert" className="my-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error.message}</p> : null;
}
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
    <span>{total ? `${page * 50 + 1} to ${Math.min((page + 1) * 50, total)} of ${total.toLocaleString()}` : "0 records"}</span>
    <div className="flex gap-2"><button className={BUTTON} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><button className={BUTTON} disabled={(page + 1) * 50 >= total} onClick={() => onPage(page + 1)}>Next</button></div>
  </div>;
}

function RecordForm({ type, related, onClose, onSaved }: { type: CrmType; related: CrmRecord | null; onClose: () => void; onSaved: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const activity = ACTIVITIES.includes(type);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ id: string }>("/api/crm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type, title: form.get("title"), body: form.get("body") || "", email: form.get("email") || "", phone: form.get("phone") || "", company: form.get("company") || "",
          occurredAt: form.get("occurredAt") ? new Date(String(form.get("occurredAt"))).toISOString() : new Date().toISOString(),
          dueAt: type === "tasks" ? new Date(String(form.get("dueAt"))).toISOString() : null, relatedId: related?.id ?? null }),
      });
      onSaved(result.id);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not save record")); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="w-[min(92vw,36rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/40" aria-labelledby="crm-form-title">
    <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4"><h2 id="crm-form-title" className="text-xl font-bold text-slate-900">{type === "tasks" ? "Schedule a task" : activity ? `Log ${SINGLE[type].toLowerCase()}` : `New ${SINGLE[type].toLowerCase()}`}</h2><button type="button" aria-label="Close form" disabled={busy} onClick={onClose} className={BUTTON}>Close</button></div>
      <p className="text-sm text-slate-600">{related ? `Linked to ${related.title}. ` : ""}Saved in Tools.{type === "emails" ? " Record a conversation you have already sent or received." : ""}</p>
      <ErrorMessage error={error} />
      <label className="block text-sm font-medium">{type === "contacts" || type === "companies" ? "Name" : "Title"}<input autoFocus name="title" required maxLength={300} className={INPUT} placeholder={type === "tasks" ? "Follow up on the railing quote" : undefined} /></label>
      {!activity && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Email<input name="email" type="email" maxLength={320} className={INPUT} /></label><label className="block text-sm font-medium">Phone<input name="phone" type="tel" maxLength={60} className={INPUT} /></label><label className="block text-sm font-medium sm:col-span-2">Company<input name="company" maxLength={300} className={INPUT} /></label></div>}
      {activity && type !== "tasks" && <label className="block text-sm font-medium">Activity date and time<input name="occurredAt" type="datetime-local" required defaultValue={localInput()} className={INPUT} /><span className="text-xs font-normal text-slate-500">Your local time</span></label>}
      {type === "tasks" && <label className="block text-sm font-medium">Due date and time<input name="dueAt" type="datetime-local" required defaultValue={localInput(new Date(Date.now() + 86400000))} className={INPUT} /><span className="text-xs font-normal text-slate-500">Your local time. The task appears in your upcoming and overdue queue.</span></label>}
      <label className="block text-sm font-medium">{type === "emails" ? "Email body" : "Notes"}<textarea name="body" rows={6} maxLength={100000} className={INPUT} /></label>
      <div className="flex justify-end"><button disabled={busy} className={PRIMARY}>{busy ? "Saving..." : type === "tasks" ? "Schedule task" : "Save in Tools"}</button></div>
    </form>
  </dialog>;
}

function TaskEditor({ record, email, canManage, onSaved }: { record: CrmRecord; email: string; canManage: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (!canManage && record.owner_email !== email) return <p className="mt-3 text-xs text-slate-500">Assigned to {record.owner_email || "an unmapped HubSpot owner"}. The task owner or management can update it.</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await fetchJson("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, version: record.version, status: form.get("status"), dueAt: new Date(String(form.get("due"))).toISOString() }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not update task")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
    <h3 className="font-semibold text-slate-800">Follow-up task</h3><ErrorMessage error={error} />
    <label className="block text-sm">Status<select name="status" defaultValue={record.effective_task_status || "open"} className={INPUT}><option value="open">Open</option><option value="completed">Completed</option></select></label>
    <label className="block text-sm">Due date and time<input type="datetime-local" name="due" required defaultValue={record.effective_due_at ? localInput(new Date(record.effective_due_at)) : ""} className={INPUT} /></label>
    <button className={PRIMARY} disabled={busy}>{busy ? "Saving..." : "Update task"}</button>
  </form>;
}

function RecordDetail({ id, email, canManage, onSelect, onAdd, onClose, onChanged }: {
  id: string; email: string; canManage: boolean; onSelect: (id: string) => void; onAdd: (type: CrmType, related: CrmRecord) => void; onClose: () => void; onChanged: () => void;
}) {
  const [relatedPage, setRelatedPage] = useState(0);
  const [relatedType, setRelatedType] = useState("all");
  const { data: record, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(id)}`, fetchJson);
  const { data: related, error: relatedError, mutate: refreshRelated } = useSWR<CrmPage>(`/api/crm?related=${encodeURIComponent(id)}&type=${relatedType}&page=${relatedPage}`, fetchJson);
  const [fieldSearch, setFieldSearch] = useState("");
  const properties = Object.entries(record?.properties ?? {}).filter(([key, value]) => value != null && value !== "" && `${key} ${String(value)}`.toLowerCase().includes(fieldSearch.toLowerCase()));
  const objectIds: Record<CrmType, string> = { contacts: "0-1", companies: "0-2", deals: "0-3", tickets: "0-5", calls: "0-48", meetings: "0-47", emails: "0-49", notes: "0-46", tasks: "0-27" };
  return <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Record details">
    <div className="flex justify-between border-b border-slate-200 px-5 py-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Record details</p><button onClick={onClose} className="text-sm font-medium text-slate-600 hover:text-slate-950">Close details</button></div>
    <div className="p-5"><ErrorMessage error={error} />{!record && !error && <p className="text-sm text-slate-500">Loading record...</p>}
      {record && <>
        <div className="flex items-center gap-2"><span className="text-xs font-medium text-slate-500">{SINGLE[record.object_type]}</span><SourceBadge source={record.source} />{record.archived && <span className="text-xs text-red-700">Archived</span>}</div>
        <h2 className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-900">{record.title}</h2>
        <p className="mt-2 break-words text-sm text-slate-600">{record.summary}</p>
        <p className="mt-2 text-xs text-slate-500">{dateLabel(record.occurred_at)}{record.owner_email ? ` · ${record.owner_email}` : ""}</p>
        {record.source === "hubspot" && <a className="mt-3 inline-block text-xs font-semibold text-orange-800 underline" href={`https://app.hubspot.com/contacts/${record.portal_id}/record/${objectIds[record.object_type]}/${record.hubspot_id}`} target="_blank" rel="noreferrer">Open original in HubSpot</a>}
        {!record.archived && <div className="my-5 flex flex-wrap gap-2">{ACTIVITIES.map(type => <button key={type} onClick={() => onAdd(type, record)} className={BUTTON}>{type === "tasks" ? "+ Task" : `+ ${SINGLE[type]}`}</button>)}</div>}
        {record.body && <div className="my-5 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 p-4 text-sm leading-relaxed text-slate-700">{record.body}</div>}
        {record.object_type === "tasks" && !record.archived && <TaskEditor key={`${record.id}:${record.version}`} record={record} email={email} canManage={canManage} onSaved={() => { void mutate(); onChanged(); }} />}
        <div className="mt-6 flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Timeline & related records</h3><button className="text-xs text-slate-500 underline" onClick={() => { void refreshRelated(); }}>Refresh</button></div>
        <label className="mt-3 block text-xs text-slate-600">Show<select value={relatedType} onChange={event => { setRelatedType(event.target.value); setRelatedPage(0); }} className={INPUT}><option value="all">All related records</option><option value="activities">Activities</option>{CRM_TYPES.map(type => <option key={type} value={type}>{CRM_LABELS[type]}</option>)}</select></label>
        <ErrorMessage error={relatedError} />
        <div className="mt-3 divide-y divide-slate-100">{related?.records.map(item => <button key={item.id} onClick={() => onSelect(item.id)} className="block w-full py-3 text-left hover:bg-slate-50"><div className="flex items-center gap-2 text-[11px] text-slate-500"><span>{SINGLE[item.object_type]}</span><SourceBadge source={item.source} /></div><p className="mt-1 truncate text-sm font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(item.object_type === "tasks" ? item.effective_due_at : item.occurred_at)}</p></button>)}{related?.total === 0 && <p className="py-5 text-sm text-slate-500">No related records yet. Add a note, conversation, or follow-up above.</p>}</div>
        {related && related.total > 50 && <Pager page={relatedPage} total={related.total} onPage={setRelatedPage} />}
        <details className="mt-6 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">All saved fields</summary><label className="mt-3 block text-xs text-slate-600">Find a field<input value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} className={INPUT} placeholder="Project details, phone, owner..." /></label><dl className="mt-3 max-h-96 divide-y divide-slate-100 overflow-auto">{properties.map(([key, value]) => <div key={key} className="py-2 text-xs"><dt className="font-semibold text-slate-500">{key.replaceAll("_", " ")}</dt><dd className="mt-1 whitespace-pre-wrap break-all text-slate-800">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></details>
        {record.source === "hubspot" && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Original property history</summary><p className="my-2 text-xs text-slate-500">Source changes retained from HubSpot.</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-[11px]">{JSON.stringify(Object.fromEntries(Object.entries(record.property_history ?? {}).filter(([, value]) => Array.isArray(value) && value.length)), null, 2)}</pre></details>}
      </>}
    </div>
  </aside>;
}

export default function CrmWorkspace({ email, canManage }: { email: string; canManage: boolean }) {
  const [tab, setTab] = useState<string>("contacts");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [taskStatus, setTaskStatus] = useState("open");
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [form, setForm] = useState<{ type: CrmType; related: CrmRecord | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<Error | null>(null);
  useEffect(() => { const timeout = setTimeout(() => { setQuery(search); setPage(0); }, 300); return () => clearTimeout(timeout); }, [search]);
  const params = new URLSearchParams({ type: tab, q: query, page: String(page), status: taskStatus, mine: String(mine), overdue: String(overdue), archived: String(archived) });
  const { data, error, isLoading, mutate } = useSWR<CrmPage>(`/api/crm?${params}`, fetchJson);
  const { data: status, mutate: refreshStatus } = useSWR<CrmStatus>("/api/crm?statusOnly=true", fetchJson, { refreshInterval: 30000 });
  const counts = Object.fromEntries(CRM_TYPES.map(type => [type, status?.counts.filter(row => row.object_type === type).reduce((sum, row) => sum + Number(row.total), 0) ?? 0]));
  async function sync() {
    setSyncing(true); setActionError(null); setNotice("");
    try {
      const result = await fetchJson<{ complete?: boolean; skipped?: string }>("/api/crm/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restart: status?.sync?.status === "complete" }) });
      setNotice(result.skipped ?? (result.complete ? "Core CRM import complete. Review migration coverage before retiring HubSpot." : "Import batch saved. Use Resume import to continue, or let the configured background worker continue."));
      await Promise.all([mutate(), refreshStatus()]);
    } catch (cause) { setActionError(cause instanceof Error ? cause : new Error("Import paused")); }
    finally { setSyncing(false); }
  }
  function changeTab(value: string) { setTab(value); setPage(0); setSelected(null); setMine(false); setOverdue(false); }
  return <div className="mx-auto max-w-[1600px] space-y-6 p-4 pb-24 sm:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-800"><span className="h-2 w-2 rounded-full bg-orange-500" /> Customer workspace</div><h1 className="text-3xl font-bold tracking-tight text-slate-950">HubSpot Dupe</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">Your customers, conversations, notes, and next steps. HubSpot history comes into Tools; new work stays here.</p></div><button className={PRIMARY} onClick={() => setForm({ type: "tasks", related: null })}>+ Schedule task</button></header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([ ["Contacts", counts.contacts], ["Companies", counts.companies], ["Conversations & notes", counts.calls + counts.meetings + counts.emails + counts.notes], ["Tasks", counts.tasks] ] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{status ? value.toLocaleString() : "..."}</p></div>)}</div>
    <details className="rounded-xl border border-orange-200 bg-orange-50/70 px-4 py-3"><summary className="cursor-pointer text-sm font-semibold text-orange-950">HubSpot import {status?.sync ? `· ${status.sync.status}` : "· setup and coverage"}</summary><div className="mt-3 space-y-3 text-sm text-orange-950"><p>Core CRM coverage: contacts, companies, deals, tickets, calls, meetings, emails, notes, tasks, original fields, property history, and their links.</p><p>Files and call recording downloads, custom objects, marketing assets, forms, lists, workflows, and inbox conversations still need a separate migration review. Keep HubSpot available until that review is complete.</p>{status?.sync && <p>Last import activity: {dateLabel(status.sync.updated_at)}</p>}{status?.sync?.last_error && <p role="alert">{status.sync.last_error}</p>}{canManage && <button disabled={syncing || !status?.configured} onClick={() => void sync()} className={BUTTON}>{syncing ? "Importing..." : status?.sync?.status === "complete" ? "Refresh from HubSpot" : "Resume import"}</button>}{!status?.configured && <p>The ongoing HubSpot connection needs server configuration. Imported records remain available in Tools.</p>}</div></details>
    <ErrorMessage error={actionError} />{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <nav aria-label="CRM sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">{["contacts", "companies", "deals", "tickets", "activities", "tasks"].map(type => <button key={type} onClick={() => changeTab(type)} aria-current={tab === type ? "page" : undefined} className={`min-h-12 whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === type ? "border-orange-600 text-orange-800" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{type === "activities" ? "Activity log" : CRM_LABELS[type as CrmType]}</button>)}</nav>
    <div className={`grid items-start gap-5 ${selected ? "xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]" : ""}`}>
      <section className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${selected ? "hidden xl:block" : ""}`} aria-label="CRM records">
        <div className="space-y-3 border-b border-slate-200 p-4"><div className="flex flex-wrap gap-3"><label className="min-w-48 flex-1 text-xs font-medium text-slate-500">Search records<input value={search} onChange={event => setSearch(event.target.value)} type="search" className={INPUT} placeholder="Name, email, phone, or conversation..." /></label><button className={`${BUTTON} self-end`} onClick={() => setForm({ type: tab === "activities" ? "notes" : tab as CrmType, related: null })}>+ {tab === "activities" ? "Log activity" : `New ${SINGLE[tab as CrmType].toLowerCase()}`}</button></div><div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); setPage(0); }} />Assigned to me</label><label className="flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setPage(0); }} />Archived records</label>
          {tab === "tasks" && <><label>Status <select value={taskStatus} onChange={event => { setTaskStatus(event.target.value); setPage(0); }} className="ml-1 rounded border border-slate-300 p-2"><option value="open">Open</option><option value="completed">Completed</option><option value="all">All</option></select></label><label className="flex items-center gap-2"><input type="checkbox" checked={overdue} onChange={event => { setOverdue(event.target.checked); setPage(0); }} />Overdue</label></>}
        </div></div>
        <div className="px-4"><ErrorMessage error={error} />{error && <button className={BUTTON} onClick={() => void mutate()}>Retry</button>}</div>
        {isLoading && <p role="status" className="p-8 text-center text-sm text-slate-500">Loading records...</p>}
        {data?.records.length === 0 && <div className="p-10 text-center"><p className="font-semibold text-slate-800">{query ? "No matching records" : "No records in this view"}</p><p className="mt-2 text-sm text-slate-500">{query || mine || archived || overdue ? "Try changing the search or filters." : "Create a record or import your HubSpot history to get started."}</p></div>}
        <div className="divide-y divide-slate-100">{data?.records.map(record => <button key={record.id} onClick={() => setSelected(record.id)} aria-pressed={selected === record.id} className={`flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition hover:bg-orange-50/50 ${selected === record.id ? "bg-orange-50 ring-1 ring-inset ring-orange-200" : ""}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-900">{record.title}</p><SourceBadge source={record.source} /></div>{record.summary && <p className="mt-1 truncate text-xs text-slate-500">{record.summary}</p>}<p className="mt-1 text-xs text-slate-500">{record.object_type === "tasks" ? `Due ${dateLabel(record.effective_due_at)}` : `${SINGLE[record.object_type]} · ${dateLabel(record.occurred_at)}`}</p></div>{record.object_type === "tasks" && <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${record.effective_task_status === "completed" ? "bg-emerald-50 text-emerald-800" : record.effective_due_at && Date.parse(record.effective_due_at) < Date.now() ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-600"}`}>{record.effective_task_status === "completed" ? "Done" : record.effective_due_at && Date.parse(record.effective_due_at) < Date.now() ? "Overdue" : "Upcoming"}</span>}</button>)}</div>
        {data && <Pager page={page} total={data.total} onPage={setPage} />}
      </section>
      {selected && <RecordDetail key={`${selected}:${detailVersion}`} id={selected} email={email} canManage={canManage} onSelect={setSelected} onAdd={(type, related) => setForm({ type, related })} onClose={() => setSelected(null)} onChanged={() => { void mutate(); void refreshStatus(); }} />}
    </div>
    {form && <RecordForm type={form.type} related={form.related} onClose={() => setForm(null)} onSaved={id => { setNotice(`${SINGLE[form.type]} saved in Tools.`); setForm(null); void mutate(); void refreshStatus(); setSelected(form.related?.id ?? id); setDetailVersion(value => value + 1); }} />}
  </div>;
}
