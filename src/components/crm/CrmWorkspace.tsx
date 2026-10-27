"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import RecordAvatar from "./RecordAvatar";
import CrmHome from "./CrmHome";
import DirectoryFilters from "./DirectoryFilters";
import { appendDirectoryFilters, directoryFilterCount, emptyDirectoryFilters, recordLocation, type DirectoryFilters as DirectorySelection, type DirectorySort } from "@/lib/crm/directory";
import { homeUrl, type CrmHomeData } from "@/lib/crm/home-window";
import { CRM_INITIAL_LIST_URL, CRM_LABELS, CRM_TYPES, type CrmPage, type CrmRecord, type CrmStatus, type CrmType } from "@/lib/crm/types";
import { BUTTON, PRIMARY, INPUT, SINGLE, SourceBadge, ErrorMessage, Pager, useDateLabel, fetchJson, cleanSummary, stageLabel, ownerLabel, recordTitle } from "./shared";

const RecordForm = dynamic(() => import("./RecordForm"), { loading: () => <p role="status" className="rounded-xl bg-white p-4">Opening form...</p> });
const RecordDetail = dynamic(() => import("./RecordDetail"), { loading: () => <aside role="status" className="rounded-xl border border-slate-200 bg-white p-5">Opening record...</aside> });
const WorkflowPanel = dynamic(() => import("./WorkflowPanel"), { loading: () => <p role="status" className="rounded-xl bg-white p-5">Opening CRM tools...</p> });
const MAINTENANCE_LABELS: Record<string, string> = { files: "Imported attachments & call recordings", duplicates: "Review duplicate contacts", capture: "Match unlinked activity" };
interface WorkspaceProps { email: string; displayName?: string; canManage: boolean; initialPage?: CrmPage; initialStatus?: CrmStatus; initialHome?: CrmHomeData; initialRecordId?: string; initialTab?: string }

export default function CrmWorkspace(props: WorkspaceProps) {
  return <WorkspaceCache key={props.email} {...props} />;
}

function WorkspaceCache(props: WorkspaceProps) {
  // Scope cached record lists (including "Assigned to me") to this viewer.
  const [cache] = useState(() => new Map());
  const fallback = {
    ...(props.initialHome ? { [homeUrl(props.initialHome.timeZone)]: props.initialHome } : {}),
    ...(props.initialPage ? { [CRM_INITIAL_LIST_URL.replace("type=contacts", `type=${props.initialTab || "contacts"}`)]: props.initialPage } : {}),
    ...(props.initialStatus ? { "/api/crm?statusOnly=true": props.initialStatus } : {}),
  };
  return <SWRConfig value={{ provider: () => cache, fallback }}><WorkspaceContent {...props} /></SWRConfig>;
}

function WorkspaceContent({ email, displayName, canManage, initialPage, initialStatus, initialHome, initialRecordId, initialTab = "home" }: WorkspaceProps) {
  const dateLabel = useDateLabel();
  const [tab, setTab] = useState<string>(initialTab);
  const { mutate: mutateCache } = useSWRConfig();
  const [useHomePreload, setUseHomePreload] = useState(true);
  const refreshHome = () => { setUseHomePreload(false); return mutateCache(key => typeof key === "string" && key.startsWith("/api/crm/home?")); };
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [taskStatus, setTaskStatus] = useState("open");
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [view, setView] = useState("all");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialRecordId ?? null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [form, setForm] = useState<{ type: CrmType; related: CrmRecord | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<Error | null>(null);
  const [maintenance, setMaintenance] = useState<string | null>(null);
  const [showTaskReminders, setShowTaskReminders] = useState(false);
  const [directoryFilters, setDirectoryFilters] = useState(emptyDirectoryFilters);
  const [directorySort, setDirectorySort] = useState<DirectorySort>("newest");
  const [directorySource, setDirectorySource] = useState("");
  const directory = tab === "contacts" || tab === "companies";
  function changeDirectoryFilters(next: DirectorySelection) {
    if (next.owner.join("\n") !== directoryFilters.owner.join("\n")) setMine(false);
    setDirectoryFilters(next); setPage(0);
  }
  useEffect(() => { const timeout = setTimeout(() => { setQuery(search); setPage(0); }, 300); return () => clearTimeout(timeout); }, [search]);
  const params = new URLSearchParams({ type: tab, q: query, page: String(page), status: taskStatus, mine: String(mine), overdue: String(overdue), archived: String(archived) });
  if (directory) appendDirectoryFilters(params, directoryFilters, directorySort, directorySource);
  if (view !== "all") params.set("filter", view);
  if (view === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
    params.set("dayStart", start.toISOString()); params.set("dayEnd", end.toISOString());
  }
  const { data, error, isLoading, isValidating, mutate } = useSWR<CrmPage>(tab === "home" ? null : `/api/crm?${params}`, fetchJson, { revalidateOnMount: !initialPage, keepPreviousData: true });
  const { data: status, mutate: refreshStatus } = useSWR<CrmStatus>("/api/crm?statusOnly=true", fetchJson, { refreshInterval: 30000, revalidateOnMount: !initialStatus });
  const counts = Object.fromEntries(CRM_TYPES.map(type => [type, status?.counts.filter(row => row.object_type === type).reduce((sum, row) => sum + Number(row.total), 0) ?? 0]));
  async function sync() {
    setSyncing(true); setActionError(null); setNotice("");
    try {
      const result = await fetchJson<{ complete?: boolean; skipped?: string }>("/api/crm/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restart: status?.sync?.status === "complete" }) });
      setNotice(result.skipped ?? (result.complete ? "Core CRM import complete. Review migration coverage before retiring HubSpot." : "Import batch saved. Use Resume import to continue, or let the configured background worker continue."));
      await Promise.all([mutate(), refreshStatus(), refreshHome()]);
    } catch (cause) { setActionError(cause instanceof Error ? cause : new Error("Import paused")); }
    finally { setSyncing(false); }
  }
  function changeTab(value: string) { setUseHomePreload(false); setTab(value); setPage(0); setSelected(null); setSearch(""); setQuery(""); setMine(false); setOverdue(false); setArchived(false); setTaskStatus("open"); setView(value === "tasks" ? "upcoming" : "all"); setDirectoryFilters(emptyDirectoryFilters()); setDirectorySource(""); setDirectorySort("newest"); }
  const title = tab === "home" ? "Home" : CRM_LABELS[tab as CrmType];
  const views = tab === "tasks" ? [["upcoming", "Next 7 days"], ["today", "Due today"], ["overdue", "Overdue"], ["all", "All open"], ["completed", "Completed"]] : [["all", `All ${title.toLowerCase()}`], ["mine", "Assigned to me"], ["recent", "Recently added"]];
  function chooseView(value: string) { setPage(0); setMine(value === "mine"); if (value === "mine") setDirectoryFilters(current => ({ ...current, owner: [] })); setOverdue(false); setTaskStatus(value === "completed" ? "completed" : "open"); setView(["mine", "completed"].includes(value) ? "all" : value); }
  function resetFilters() { setSearch(""); setQuery(""); setArchived(false); setDirectoryFilters(emptyDirectoryFilters()); setDirectorySource(""); setDirectorySort("newest"); chooseView(tab === "tasks" ? "upcoming" : "all"); }
  const filtered = Boolean(query || mine || archived || view !== "all" || directorySource || directoryFilterCount(directoryFilters));
  return <div className="mx-auto max-w-[1600px] space-y-4 bg-slate-50 p-3 pb-24 sm:p-4 lg:p-5">
    <header className="flex items-center justify-between gap-3"><h1 className="text-lg font-bold tracking-tight text-slate-900">HubSpot Dupe</h1><span className="text-xs text-slate-500">{status ? `${counts.contacts.toLocaleString()} contacts` : "Loading workspace"}</span></header>
    <ErrorMessage error={actionError} />{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <nav aria-label="CRM sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">{["home", "contacts", "companies", "tasks"].map(type => <button key={type} onClick={() => changeTab(type)} aria-current={tab === type ? "page" : undefined} className={`min-h-12 whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === type ? "border-orange-600 text-orange-800" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{type === "home" ? "Home" : CRM_LABELS[type as CrmType]}</button>)}</nav>
    {selected ? <RecordDetail key={`${selected}:${detailVersion}`} id={selected} preview={data?.records.find(record => record.id === selected)} email={email} canManage={canManage} onSelect={setSelected} onAdd={(type, related) => setForm({ type, related })} onClose={() => setSelected(null)} onChanged={() => { void mutate(); void refreshStatus(); void refreshHome(); }} /> : tab === "home" ? <CrmHome email={email} displayName={displayName} initialHome={useHomePreload ? initialHome : undefined} status={status} onSelect={id => { setUseHomePreload(false); setSelected(id); }} onAdd={type => setForm({ type, related: null })} onNavigate={(nextTab, nextView = "all", assigned = false, nextStatus = "open") => { changeTab(nextTab); setView(nextView); setMine(assigned); setTaskStatus(nextStatus); }} /> : <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="CRM records" aria-busy={isValidating}>
      <div className="flex items-center justify-between gap-3 px-5 py-5"><div><h2 className="text-2xl font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{data ? `${data.total.toLocaleString()} ${filtered ? "matches" : "records"}` : "Loading records"}{tab === "tasks" ? " · Plan your next customer follow-up" : " · Open a record to view details and activity"}</p></div><button className={PRIMARY} onClick={() => setForm({ type: tab as CrmType, related: null })}>+ {`New ${SINGLE[tab as CrmType].toLowerCase()}`}</button></div>
      <div role="tablist" aria-label={`${title} views`} className="flex gap-1 overflow-x-auto border-y border-slate-200 bg-slate-50/70 px-4">{views.map(([key, label]) => { const active = key === "mine" ? mine : key === "completed" ? taskStatus === "completed" : !mine && taskStatus !== "completed" && view === key; return <button role="tab" aria-selected={active} key={key} onClick={() => chooseView(key)} className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-medium ${active ? "border-orange-600 bg-white text-orange-800" : "border-transparent text-slate-600 hover:bg-white"}`}>{label}</button>; })}</div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 px-5 py-3"><label className="w-full max-w-sm text-xs font-medium text-slate-600">Search {title.toLowerCase()}<input value={search} onChange={event => setSearch(event.target.value)} type="search" className={INPUT} placeholder="Name, email, phone, or keyword" /></label><div className="flex min-h-11 flex-wrap items-center gap-4 text-xs text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); if (event.target.checked) setDirectoryFilters(current => ({ ...current, owner: [] })); setPage(0); }} />Assigned to me</label><label className="flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setPage(0); }} />Archived records</label><button className="font-semibold text-slate-600 underline" onClick={resetFilters}>Reset filters</button></div></div>
      {directory && <DirectoryFilters key={tab} type={tab} email={email} archived={archived} filters={directoryFilters} source={directorySource} sort={directorySort} onChange={changeDirectoryFilters} onSource={value => { setDirectorySource(value); setPage(0); }} onSort={value => { setDirectorySort(value); setPage(0); }} onClear={resetFilters} />}
      <div className="px-4"><ErrorMessage error={error} />{error && <button className={BUTTON} onClick={() => void mutate()}>Retry</button>}</div>
      {isLoading && !data && <p role="status" className="p-8 text-center text-sm text-slate-500">Loading records...</p>}
      {data && isValidating && <p role="status" className="px-5 py-2 text-xs text-slate-500">Updating records...</p>}
      {data?.records.length === 0 && <div className="p-10 text-center"><p className="font-semibold text-slate-800">{filtered ? "No matching records" : "No records in this view"}</p><p className="mt-2 text-sm text-slate-500">{tab === "tasks" ? "Choose another view or schedule a new follow-up." : "Try changing the search or filters, or create a new record."}</p></div>}
      {!!data?.records.length && <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><tr><th scope="col" className="px-5 py-3">{tab === "contacts" || tab === "companies" ? "Name" : "Title"}</th>{tab === "contacts" ? <><th scope="col" className="px-4 py-3">Email</th><th scope="col" className="px-4 py-3">Phone</th><th scope="col" className="px-4 py-3">Company</th></> : tab === "companies" ? <><th scope="col" className="px-4 py-3">Domain</th><th scope="col" className="px-4 py-3">Phone</th></> : <th scope="col" className="px-4 py-3">Details</th>}{directory && <th scope="col" className="px-4 py-3">Location</th>}<th scope="col" className="px-4 py-3">Owner</th><th scope="col" className="px-4 py-3">{tab === "tasks" ? "Status" : directory ? "Lifecycle stage" : "Source"}</th><th scope="col" className="px-4 py-3">{tab === "tasks" ? "Due date" : "Date added"}</th></tr></thead><tbody className="divide-y divide-slate-100">{data.records.map(record => <tr key={record.id} className="hover:bg-orange-50/40"><td className="max-w-56 px-5 py-3"><button onClick={() => setSelected(record.id)} className="flex max-w-56 items-center gap-3 text-left font-semibold text-cyan-800 hover:underline">{["contacts", "companies"].includes(record.object_type) && <RecordAvatar record={record} />}<span className="min-w-0 truncate">{recordTitle(record)}</span></button>{record.source === "tools" && <SourceBadge source={record.source} />}</td>{tab === "contacts" ? <><td className="max-w-44 truncate px-4 py-3 text-slate-600">{record.view_fields?.email || "Not set"}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{record.view_fields?.phone || "Not set"}</td><td className="max-w-44 truncate px-4 py-3 text-slate-600">{record.view_fields?.company || "Not set"}</td></> : tab === "companies" ? <><td className="max-w-48 truncate px-4 py-3 text-slate-600">{record.view_fields?.domain || record.view_fields?.website || "Not set"}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{record.view_fields?.phone || "Not set"}</td></> : <td className="max-w-72 truncate px-4 py-3 text-slate-500">{record.view_fields?.preview || cleanSummary(record.summary) || SINGLE[record.object_type]}</td>}{directory && <td className="max-w-56 truncate px-4 py-3 text-slate-600" title={recordLocation(record.view_fields)}>{recordLocation(record.view_fields) || "Not set"}</td>}<td className="whitespace-nowrap px-4 py-3 text-xs capitalize text-slate-600" title={record.owner_email ?? ""}>{ownerLabel(record.owner_email)}</td><td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${record.effective_task_status === "completed" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{record.object_type === "tasks" ? record.effective_task_status === "completed" ? "Completed" : "Open" : directory ? record.view_fields?.stage_label || stageLabel(record.view_fields?.stage) : record.source === "hubspot" ? "HubSpot" : "Tools"}</span></td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{dateLabel(record.object_type === "tasks" ? record.effective_due_at : record.occurred_at)}</td></tr>)}</tbody></table></div>}
      {data && <Pager page={data.page} total={data.total} onPage={setPage} busy={isValidating} />}
      {tab === "tasks" && <details open={showTaskReminders} onToggle={event => setShowTaskReminders(event.currentTarget.open)} className="border-t border-slate-200 px-5 py-3">
        <summary className="cursor-pointer py-1 text-sm font-semibold text-slate-700">Task reminders and delivery history</summary>
        {showTaskReminders && <div className="mt-3"><WorkflowPanel view="reminders" canManage={canManage} onSelect={setSelected} /></div>}
      </details>}
    </section>}
    <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
      <summary className="cursor-pointer font-medium">HubSpot connection {status?.sync ? `· ${status.sync.status}` : "· setup"}</summary>
      <div className="mt-3 space-y-3">
        <p>Imported records retain their original fields, history, and links. New activity and contact edits are saved in Tools.</p>
        <p>Keep HubSpot available until file copies and remaining account features have been reviewed.</p>
        {status?.sync && <p>Last import: {dateLabel(status.sync.updated_at)}</p>}{status?.sync?.last_error && <p role="alert">{status.sync.last_error}</p>}
        {canManage && <button disabled={syncing || !status?.configured} onClick={() => void sync()} className={BUTTON}>{syncing ? "Importing..." : status?.sync?.status === "complete" ? "Refresh from HubSpot" : "Resume import"}</button>}
        {!status?.configured && <p>Ongoing import is not configured. Saved records remain available.</p>}
        <div className="border-t border-slate-100 pt-3"><p className="mb-2 font-semibold text-slate-600">Data maintenance</p><div className="flex flex-wrap gap-2">{Object.entries(MAINTENANCE_LABELS).map(([key, label]) => <button key={key} onClick={() => setMaintenance(maintenance === key ? null : key)} aria-pressed={maintenance === key} className={BUTTON}>{label}</button>)}</div></div>
        {maintenance && <WorkflowPanel key={maintenance} view={maintenance} canManage={canManage} onSelect={setSelected} />}
      </div>
    </details>
    {form && <RecordForm type={form.type} related={form.related} onClose={() => setForm(null)} onSaved={id => { setNotice(`${SINGLE[form.type]} saved in Tools.`); setForm(null); void mutate(); void refreshStatus(); void refreshHome(); setSelected(form.related?.id ?? id); setDetailVersion(value => value + 1); }} />}
  </div>;
}
