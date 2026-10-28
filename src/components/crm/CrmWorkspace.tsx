"use client";

import { useEffect, useEffectEvent, useState } from "react";
import dynamic from "next/dynamic";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import CrmHome from "./CrmHome";
import DirectoryFilters from "./DirectoryFilters";
import DirectoryViews from "./DirectoryViews";
import DirectoryTable from "./DirectoryTable";
import RecordPreview from "./RecordPreview";
import GlobalSearch from "./GlobalSearch";
import TaskTable from "./TaskTable";
import ExportButton from "./ExportButton";
import { defaultColumns, FOLLOWUP_FILTERS, type DirectoryColumn, type DirectoryType, type DirectoryViewConfig, type FollowupFilter } from "@/lib/crm/directory-workflows";
import { appendDirectoryFilters, directoryFilterCount, emptyDirectoryFilters, type DirectoryFilters as DirectorySelection, type DirectorySort } from "@/lib/crm/directory";
import { homeUrl, type CrmHomeData } from "@/lib/crm/home-window";
import { CRM_INITIAL_LIST_URL, CRM_LABELS, CRM_TYPES, type CrmPage, type CrmRecord, type CrmStatus, type CrmType } from "@/lib/crm/types";
import { crmId } from "@/lib/crm/input";
import { BUTTON, PRIMARY, INPUT, SINGLE, ErrorMessage, Pager, fetchJson, useDateLabel } from "./shared";

const RecordForm = dynamic(() => import("./RecordForm"), { loading: () => <p role="status" className="rounded-xl bg-white p-4">Opening form...</p> });
const RecordDetail = dynamic(() => import("./RecordDetail"), { loading: () => <aside role="status" className="rounded-xl border border-slate-200 bg-white p-5">Opening record...</aside> });
const WorkflowPanel = dynamic(() => import("./WorkflowPanel"), { loading: () => <p role="status" className="rounded-xl bg-white p-5">Opening CRM tools...</p> });
const CrmReports = dynamic(() => import("./CrmReports"), { loading: () => <p role="status" className="rounded-xl bg-white p-5">Opening reports...</p> });
const SECTIONS = ["contacts", "companies", "tasks", "reports"];
const NAV = ["home", "contacts", "companies", "tasks", "reports"];
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
  const [directorySource, setDirectorySource] = useState<"" | "tools" | "hubspot">("");
  const [followup, setFollowup] = useState<FollowupFilter>("all");
  const [columnsByType, setColumnsByType] = useState<Record<DirectoryType, DirectoryColumn[]>>(() => ({ contacts: defaultColumns("contacts"), companies: defaultColumns("companies") }));
  const [preview, setPreview] = useState<CrmRecord | null>(null);
  const directory = tab === "contacts" || tab === "companies";
  const directoryType = tab === "companies" ? "companies" : "contacts";
  const directoryConfig: DirectoryViewConfig = { search, filters: directoryFilters, sort: directorySort, source: directorySource, mine, archived, recent: view === "recent", followup, columns: columnsByType[directoryType] };
  function applyDirectoryView(config: DirectoryViewConfig) {
    setSearch(config.search); setQuery(config.search); setDirectoryFilters(config.filters); setDirectorySort(config.sort); setDirectorySource(config.source);
    setMine(config.mine); setArchived(config.archived); setView(config.recent ? "recent" : "all"); setFollowup(config.followup); setPage(0);
    setColumnsByType(current => ({ ...current, [directoryType]: config.columns }));
  }
  // Keep the section and open record in the address bar so Back and Forward
  // move within the CRM instead of leaving it.
  function pushLocation(nextTab: string, record: string | null) {
    const url = new URL(window.location.href);
    if (nextTab === "home") url.searchParams.delete("section"); else url.searchParams.set("section", nextTab);
    if (record) url.searchParams.set("record", record); else url.searchParams.delete("record");
    if (url.href !== window.location.href) window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function selectRecord(id: string | null) { setSelected(id); pushLocation(tab, id); }
  const restoreLocation = useEffectEvent(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section") ?? "";
    const nextTab = SECTIONS.includes(section) ? section : "home";
    if (nextTab !== tab) resetTab(nextTab);
    const record = crmId.safeParse(params.get("record"));
    setSelected(record.success ? record.data : null);
  });
  useEffect(() => {
    const onPopState = () => restoreLocation();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  function openRecord(id: string) { setPreview(null); selectRecord(id); }
  function refreshDirectory() { void mutate(); void refreshStatus(); void refreshHome(); void mutateCache(key => typeof key === "string" && key.startsWith("/api/crm?filtersOnly=")); }

  function changeDirectoryFilters(next: DirectorySelection) {
    if (next.owner.join("\n") !== directoryFilters.owner.join("\n")) setMine(false);
    setDirectoryFilters(next); setPage(0);
  }
  useEffect(() => { const timeout = setTimeout(() => { setQuery(search); setPage(0); }, 300); return () => clearTimeout(timeout); }, [search]);
  const params = new URLSearchParams({ type: tab, q: query, page: String(page), status: taskStatus, mine: String(mine), overdue: String(overdue), archived: String(archived) });
  if (directory) { appendDirectoryFilters(params, directoryFilters, directorySort, directorySource); if (followup !== "all") params.set("followup", followup); }
  if (view !== "all") params.set("filter", view);
  if (view === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
    params.set("dayStart", start.toISOString()); params.set("dayEnd", end.toISOString());
  }
  const { data, error, isLoading, isValidating, mutate } = useSWR<CrmPage>(tab === "home" || tab === "reports" ? null : `/api/crm?${params}`, fetchJson, { revalidateOnMount: !initialPage, keepPreviousData: true });
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
  function changeTab(value: string) { resetTab(value); pushLocation(value, null); }
  function resetTab(value: string) { setUseHomePreload(false); setTab(value); setPage(0); setSelected(null); setSearch(""); setQuery(""); setMine(false); setOverdue(false); setArchived(false); setTaskStatus("open"); setView(value === "tasks" ? "upcoming" : "all"); setDirectoryFilters(emptyDirectoryFilters()); setDirectorySource(""); setDirectorySort("newest"); setFollowup("all"); setPreview(null); }
  const title = tab === "home" ? "Home" : tab === "reports" ? "Reports" : CRM_LABELS[tab as CrmType];
  const views = tab === "tasks" ? [["upcoming", "Next 7 days"], ["today", "Due today"], ["overdue", "Overdue"], ["all", "All open"], ["completed", "Completed"]] : [["all", `All ${title.toLowerCase()}`], ["mine", "Assigned to me"], ["recent", "Recently added"]];
  // Tasks has no "Assigned to me" view; keep that checkbox while switching task views.
  function chooseView(value: string) { setPage(0); if (tab !== "tasks") setMine(value === "mine"); if (value === "mine") setDirectoryFilters(current => ({ ...current, owner: [] })); setOverdue(false); setTaskStatus(value === "completed" ? "completed" : "open"); setView(["mine", "completed"].includes(value) ? "all" : value); }
  function resetFilters() { setSearch(""); setQuery(""); setMine(false); setArchived(false); setDirectoryFilters(emptyDirectoryFilters()); setDirectorySource(""); setDirectorySort("newest"); setFollowup("all"); chooseView(tab === "tasks" ? "upcoming" : "all"); }
  const filtered = Boolean(query || mine || archived || view !== (tab === "tasks" ? "upcoming" : "all") || directorySource || followup !== "all" || directoryFilterCount(directoryFilters));
  return <div className="mx-auto max-w-[1600px] space-y-4 bg-slate-50 p-3 pb-24 sm:p-4 lg:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-lg font-bold tracking-tight text-slate-900">HubSpot Dupe</h1><div className="flex min-w-0 flex-1 items-center justify-end gap-3"><GlobalSearch onSelect={id => { setPreview(null); selectRecord(id); }} /><span className="hidden text-xs text-slate-500 sm:inline">{status ? `${counts.contacts.toLocaleString()} contacts` : "Loading workspace"}</span></div></header>
    <ErrorMessage error={actionError} />{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <nav aria-label="CRM sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">{NAV.map(type => <button key={type} onClick={() => changeTab(type)} aria-current={tab === type ? "page" : undefined} className={`min-h-12 whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === type ? "border-orange-600 text-orange-800" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{type === "home" ? "Home" : type === "reports" ? "Reports" : CRM_LABELS[type as CrmType]}</button>)}</nav>
    {selected ? <RecordDetail key={`${selected}:${detailVersion}`} id={selected} preview={data?.records.find(record => record.id === selected)} email={email} canManage={canManage} onSelect={selectRecord} onAdd={(type, related) => setForm({ type, related })} onClose={() => selectRecord(null)} onChanged={() => { void mutate(); void refreshStatus(); void refreshHome(); }} /> : tab === "home" ? <CrmHome email={email} displayName={displayName} initialHome={useHomePreload ? initialHome : undefined} status={status} onSelect={id => { setUseHomePreload(false); selectRecord(id); }} onAdd={type => setForm({ type, related: null })} onNavigate={(nextTab, nextView = "all", assigned = false, nextStatus = "open") => { changeTab(nextTab); setView(nextView); setMine(assigned); setTaskStatus(nextStatus); }} canManage={canManage} onChanged={() => void refreshHome()} /> : tab === "reports" ? <CrmReports email={email} /> : <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="CRM records" aria-busy={isValidating}>
      <div className="flex items-center justify-between gap-3 px-5 py-5"><div><h2 className="text-2xl font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{data ? `${data.total.toLocaleString()} ${filtered ? "matches" : "records"}` : "Loading records"}{tab === "tasks" ? " · Plan your next customer follow-up" : " · Open a record to view details and activity"}</p></div><div className="flex flex-wrap items-start justify-end gap-2">{directory && canManage && <ExportButton params={params} total={data?.total} />}<button className={PRIMARY} onClick={() => setForm({ type: tab as CrmType, related: null })}>+ {`New ${SINGLE[tab as CrmType].toLowerCase()}`}</button></div></div>
      <div role="tablist" aria-label={`${title} views`} className="flex gap-1 overflow-x-auto border-y border-slate-200 bg-slate-50/70 px-4">{views.map(([key, label]) => { const active = key === "mine" ? mine : key === "completed" ? taskStatus === "completed" : (tab === "tasks" || !mine) && taskStatus !== "completed" && view === key; return <button role="tab" aria-selected={active} key={key} onClick={() => chooseView(key)} className={`min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-medium ${active ? "border-orange-600 bg-white text-orange-800" : "border-transparent text-slate-600 hover:bg-white"}`}>{label}</button>; })}</div>
      {directory && <DirectoryViews key={`views:${tab}`} type={directoryType} config={directoryConfig} onApply={applyDirectoryView} onColumns={columns => setColumnsByType(current => ({ ...current, [directoryType]: columns }))} />}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 px-5 py-3"><label className="w-full max-w-sm text-xs font-medium text-slate-600">Search {title.toLowerCase()}<input value={search} onChange={event => setSearch(event.target.value)} type="search" className={INPUT} placeholder="Name, email, phone, or keyword" /></label><div className="flex min-h-11 flex-wrap items-center gap-4 text-xs text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); if (event.target.checked) setDirectoryFilters(current => ({ ...current, owner: [] })); setPage(0); }} />Assigned to me</label><label className="flex items-center gap-2"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setPage(0); }} />Archived records</label><button className="font-semibold text-slate-600 underline" onClick={resetFilters}>Reset filters</button></div></div>
      {directory && <DirectoryFilters key={`filters:${tab}`} type={tab} email={email} archived={archived} filters={directoryFilters} source={directorySource} sort={directorySort} onChange={changeDirectoryFilters} onSource={value => { setDirectorySource(value as "" | "tools" | "hubspot"); setPage(0); }} onSort={value => { setDirectorySort(value); setPage(0); }} onClear={resetFilters} />}
      {directory && <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-2"><label className="flex items-center gap-2 text-xs font-medium text-slate-500">Follow-up<select value={followup} onChange={event => { setFollowup(event.target.value as FollowupFilter); setPage(0); }} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">{Object.entries(FOLLOWUP_FILTERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{followup !== "all" && <button className="text-xs text-slate-500 underline" onClick={() => { setFollowup("all"); setPage(0); }}>Clear follow-up filter</button>}</div>}
      <div className="px-4"><ErrorMessage error={error} />{error && <button className={BUTTON} onClick={() => void mutate()}>Retry</button>}</div>
      {isLoading && !data && <p role="status" className="p-8 text-center text-sm text-slate-500">Loading records...</p>}
      {data && isValidating && <p role="status" className="px-5 py-2 text-xs text-slate-500">Updating records...</p>}
      {data?.records.length === 0 && <div className="p-10 text-center"><p className="font-semibold text-slate-800">{filtered ? "No matching records" : "No records in this view"}</p><p className="mt-2 text-sm text-slate-500">{tab === "tasks" ? "Choose another view or schedule a new follow-up." : "Try changing the search or filters, or create a new record."}</p></div>}
      {directory && !!data?.records.length && <DirectoryTable key={params.toString()} type={directoryType} records={data.records} columns={columnsByType[directoryType]} email={email} busy={isValidating} onSelect={openRecord} onPreview={setPreview} onChanged={count => { setNotice(`${count} records updated.`); refreshDirectory(); }} />}
      {!directory && !!data?.records.length && <TaskTable key={params.toString()} records={data.records} email={email} canManage={canManage} onSelect={openRecord} onChanged={() => { void mutate(); void refreshHome(); }} />}
      {data && <Pager page={data.page} total={data.total} onPage={setPage} busy={isValidating} />}
      {tab === "tasks" && <details open={showTaskReminders} onToggle={event => setShowTaskReminders(event.currentTarget.open)} className="border-t border-slate-200 px-5 py-3">
        <summary className="cursor-pointer py-1 text-sm font-semibold text-slate-700">Task reminders and delivery history</summary>
        {showTaskReminders && <div className="mt-3"><WorkflowPanel view="reminders" canManage={canManage} onSelect={selectRecord} /></div>}
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
        {maintenance && <WorkflowPanel key={maintenance} view={maintenance} canManage={canManage} onSelect={selectRecord} />}
      </div>
    </details>
    {preview && directory && !selected && <RecordPreview key={`${preview.id}:${detailVersion}`} record={preview} onClose={() => setPreview(null)} onOpen={openRecord} onAdd={(type, related) => setForm({ type, related })} onChanged={refreshDirectory} />}
    {form && <RecordForm type={form.type} related={form.related} email={email} onOpenExisting={id => { setForm(null); setPreview(null); selectRecord(id); }} onClose={() => setForm(null)} onSaved={id => { setNotice(`${SINGLE[form.type]} saved in Tools.`); setForm(null); void mutate(); void refreshStatus(); void refreshHome(); if (!preview) selectRecord(form.related?.id ?? id); setDetailVersion(value => value + 1); }} />}
  </div>;
}
