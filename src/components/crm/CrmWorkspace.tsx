"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import useSWR, { SWRConfig } from "swr";
import { CRM_INITIAL_LIST_URL, CRM_LABELS, CRM_TYPES, type CrmPage, type CrmRecord, type CrmStatus, type CrmType } from "@/lib/crm/types";
import { BUTTON, PRIMARY, INPUT, SINGLE, SourceBadge, ErrorMessage, Pager, useDateLabel, fetchJson } from "./shared";

const RecordForm = dynamic(() => import("./RecordForm"), { loading: () => <p role="status" className="rounded-xl bg-white p-4">Opening form...</p> });
const RecordDetail = dynamic(() => import("./RecordDetail"), { loading: () => <aside role="status" className="rounded-xl border border-slate-200 bg-white p-5">Opening record...</aside> });
interface WorkspaceProps { email: string; canManage: boolean; initialPage?: CrmPage; initialStatus?: CrmStatus }

export default function CrmWorkspace(props: WorkspaceProps) {
  return <WorkspaceCache key={props.email} {...props} />;
}

function WorkspaceCache(props: WorkspaceProps) {
  // Scope cached record lists (including "Assigned to me") to this viewer.
  const [cache] = useState(() => new Map());
  const fallback = {
    ...(props.initialPage ? { [CRM_INITIAL_LIST_URL]: props.initialPage } : {}),
    ...(props.initialStatus ? { "/api/crm?statusOnly=true": props.initialStatus } : {}),
  };
  return <SWRConfig value={{ provider: () => cache, fallback }}><WorkspaceContent {...props} /></SWRConfig>;
}

function WorkspaceContent({ email, canManage, initialPage, initialStatus }: WorkspaceProps) {
  const dateLabel = useDateLabel();
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
  const { data, error, isLoading, isValidating, mutate } = useSWR<CrmPage>(`/api/crm?${params}`, fetchJson, { revalidateOnMount: !initialPage, keepPreviousData: true });
  const { data: status, mutate: refreshStatus } = useSWR<CrmStatus>("/api/crm?statusOnly=true", fetchJson, { refreshInterval: 30000, revalidateOnMount: !initialStatus });
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
      <section className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${selected ? "hidden xl:block" : ""}`} aria-label="CRM records" aria-busy={isValidating}>
        <div className="space-y-3 border-b border-slate-200 p-4"><div className="flex flex-wrap gap-3"><label className="min-w-48 flex-1 text-xs font-medium text-slate-500">Search records<input value={search} onChange={event => setSearch(event.target.value)} type="search" className={INPUT} placeholder="Name, email, phone, or conversation..." /></label><button className={`${BUTTON} self-end`} onClick={() => setForm({ type: tab === "activities" ? "notes" : tab as CrmType, related: null })}>+ {tab === "activities" ? "Log activity" : `New ${SINGLE[tab as CrmType].toLowerCase()}`}</button></div><div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); setPage(0); }} />Assigned to me</label><label className="flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setPage(0); }} />Archived records</label>
          {tab === "tasks" && <><label>Status <select value={taskStatus} onChange={event => { setTaskStatus(event.target.value); setPage(0); }} className="ml-1 rounded border border-slate-300 p-2"><option value="open">Open</option><option value="completed">Completed</option><option value="all">All</option></select></label><label className="flex items-center gap-2"><input type="checkbox" checked={overdue} onChange={event => { setOverdue(event.target.checked); setPage(0); }} />Overdue</label></>}
        </div></div>
        <div className="px-4"><ErrorMessage error={error} />{error && <button className={BUTTON} onClick={() => void mutate()}>Retry</button>}</div>
        {isLoading && !data && <p role="status" className="p-8 text-center text-sm text-slate-500">Loading records...</p>}
        {data && isValidating && <p role="status" className="px-4 py-2 text-xs text-slate-500">Updating records...</p>}
        {data?.records.length === 0 && <div className="p-10 text-center"><p className="font-semibold text-slate-800">{query ? "No matching records" : "No records in this view"}</p><p className="mt-2 text-sm text-slate-500">{query || mine || archived || overdue ? "Try changing the search or filters." : "Create a record or import your HubSpot history to get started."}</p></div>}
        <div className="divide-y divide-slate-100">{data?.records.map(record => <button key={record.id} onClick={() => setSelected(record.id)} aria-pressed={selected === record.id} className={`flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition hover:bg-orange-50/50 ${selected === record.id ? "bg-orange-50 ring-1 ring-inset ring-orange-200" : ""}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-900">{record.title}</p><SourceBadge source={record.source} /></div>{record.summary && <p className="mt-1 truncate text-xs text-slate-500">{record.summary}</p>}<p className="mt-1 text-xs text-slate-500">{record.object_type === "tasks" ? `Due ${dateLabel(record.effective_due_at)}` : `${SINGLE[record.object_type]} · ${dateLabel(record.occurred_at)}`}</p></div>{record.object_type === "tasks" && <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${record.effective_task_status === "completed" ? "bg-emerald-50 text-emerald-800" : record.effective_due_at && Date.parse(record.effective_due_at) < Date.now() ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-600"}`}>{record.effective_task_status === "completed" ? "Done" : record.effective_due_at && Date.parse(record.effective_due_at) < Date.now() ? "Overdue" : "Upcoming"}</span>}</button>)}</div>
        {data && <Pager page={data.page} total={data.total} onPage={setPage} busy={isValidating} />}
      </section>
      {selected && <RecordDetail key={`${selected}:${detailVersion}`} id={selected} preview={data?.records.find(record => record.id === selected)} email={email} canManage={canManage} onSelect={setSelected} onAdd={(type, related) => setForm({ type, related })} onClose={() => setSelected(null)} onChanged={() => { void mutate(); void refreshStatus(); }} />}
    </div>
    {form && <RecordForm type={form.type} related={form.related} onClose={() => setForm(null)} onSaved={id => { setNotice(`${SINGLE[form.type]} saved in Tools.`); setForm(null); void mutate(); void refreshStatus(); setSelected(form.related?.id ?? id); setDetailVersion(value => value + 1); }} />}
  </div>;
}
