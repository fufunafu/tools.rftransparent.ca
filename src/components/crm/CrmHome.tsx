"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import useSWR from "swr";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { HOME_ACTIVITIES, homeUrl, type CrmHomeData, type HomeActivity, type HomeScope } from "@/lib/crm/home-window";
import type { CrmRecord, CrmStatus, CrmType } from "@/lib/crm/types";
import RecordAvatar from "./RecordAvatar";
import QuickComplete from "./QuickComplete";
import { BUTTON, ErrorMessage, fetchJson, ownerLabel, recordTitle, stageLabel } from "./shared";

const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || BUSINESS_TIMEZONE;
const serverZone = () => BUSINESS_TIMEZONE;
const ACTIVITY_NAMES: Record<string, string> = { emails: "Email", calls: "Call", meetings: "Meeting", notes: "Note", tasks: "Task" };
const ICONS: Record<string, string> = {
  meetings: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  tasks: "m8 12 3 3 5-6M9 3H5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4M9 2h6v4H9Z",
  emails: "m3 6 9 7 9-7M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  calls: "M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z",
  notes: "M8 8h8M8 12h6M5 3h14v14l-4 4H5Z",
};
function Icon({ type }: { type: string }) { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d={ICONS[type] || ICONS.notes} /></svg>; }
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) { return <section aria-label={title} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2"><h3 className="font-semibold text-slate-900">{title}</h3>{action}</div>{children}</section>; }
function Empty({ type, title, children }: { type: string; title: string; children?: ReactNode }) {
  return <div className="flex min-h-28 flex-1 items-start gap-3 px-4 py-5">
    <span className="shrink-0 rounded-lg bg-slate-50 p-2 text-slate-400"><Icon type={type} /></span>
    <div className="min-w-0 pt-1"><p className="text-sm font-medium text-slate-700">{title}</p>{children && <div className="mt-1 text-xs leading-relaxed text-slate-500">{children}</div>}</div>
  </div>;
}

export default function CrmHome({ email, displayName, initialHome, status, onSelect, onAdd, onNavigate, canManage = false, onChanged }: {
  email: string; displayName?: string; initialHome?: CrmHomeData; status?: CrmStatus; canManage?: boolean; onChanged?: () => void;
  onSelect: (id: string) => void; onAdd: (type: CrmType) => void;
  onNavigate: (tab: string, view?: string, mine?: boolean, taskStatus?: "open" | "completed") => void;
}) {
  const timeZone = useSyncExternalStore(subscribe, browserZone, serverZone);
  const [scope, setScope] = useState<HomeScope>("mine");
  const [taskView, setTaskView] = useState<"open" | "completed">("open");
  const [activity, setActivity] = useState<HomeActivity>("all");
  const { data, error, isLoading, isValidating, mutate } = useSWR<CrmHomeData>(homeUrl(timeZone, scope, activity), fetchJson, {
    revalidateOnMount: !initialHome || initialHome.timeZone !== timeZone,
    refreshInterval: 60000,
  });
  const name = (displayName || ownerLabel(email)).trim().split(/\s+/)[0];
  const now = data ? new Date(data.asOf) : null;
  const hour = now ? Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone }).format(now)) : null;
  const greeting = hour === null ? "Welcome back" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = now ? new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone }).format(now) : "Your CRM workspace";
  const time = (value: string | null) => value ? new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value)) : "No time";
  const stamp = (value: string | null) => value ? new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value)) : "No date";
  const mine = scope === "mine";
  const open = (record: CrmRecord) => onSelect(record.id);
  return <div className="space-y-4" aria-label="CRM Home">
    <div className="flex flex-wrap items-center justify-between gap-3 py-1">
      <div><p className="text-xs text-slate-500">{date}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{greeting}, <span className="capitalize">{name}</span></h2></div>
      <div className="flex items-center gap-2"><div role="group" aria-label="Home scope" className="flex rounded-lg border border-slate-200 bg-white p-1">{(["mine", "team"] as const).map(value => <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${scope === value ? "bg-orange-50 text-orange-800" : "text-slate-500 hover:bg-slate-50"}`}>{value === "mine" ? "My work" : "Team"}</button>)}</div><button className={BUTTON} disabled={isValidating} onClick={() => void mutate()} aria-label="Refresh Home">Refresh</button></div>
    </div>
    <ErrorMessage error={error} />{error && <button className={BUTTON} onClick={() => void mutate()}>Retry Home</button>}
    {isLoading && !data && <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading your day...</p>}
    {data && <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <Card title="Tasks" action={<button className="min-h-10 rounded-lg bg-orange-700 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-800" onClick={() => onAdd("tasks")}>+ New task</button>}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4"><div role="tablist" aria-label="Today's tasks" className="flex gap-5">{(["open", "completed"] as const).map(value => <button role="tab" aria-selected={taskView === value} key={value} onClick={() => setTaskView(value)} className={`min-h-11 border-b-2 text-sm font-medium ${taskView === value ? "border-orange-600 text-orange-800" : "border-transparent text-slate-500"}`}>{value === "open" ? "Open" : "Completed"} <span className="ml-1 text-xs">{value === "open" ? data.tasks.openTotal : data.tasks.completedTotal}</span></button>)}</div><span className="text-xs text-slate-500">Due today</span></div>
          {data.tasks[taskView].length ? <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 px-4">{data.tasks[taskView].map(record => <div key={`${record.id}:${record.version}`} className="flex w-full items-center gap-3 py-3 hover:bg-slate-50"><QuickComplete record={record} email={email} canManage={canManage} onChanged={() => { void mutate(); onChanged?.(); }} /><button onClick={() => open(record)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="min-w-0 flex-1"><span className={`block truncate text-sm font-semibold ${taskView === "completed" ? "text-slate-500 line-through" : "text-cyan-800"}`}>{recordTitle(record)}</span><span className="mt-1 block text-xs capitalize text-slate-500">{ownerLabel(record.owner_email)}</span></span><span className="shrink-0 text-xs text-slate-500">{time(record.effective_due_at)}</span></button></div>)}</div> : <Empty type="tasks" title={taskView === "open" ? "You have no open tasks due today" : "No completed tasks due today"}>{taskView === "open" ? "Schedule a follow-up or review upcoming tasks." : "Completed tasks with today's due date appear here."}</Empty>}
          <button className="mt-auto min-h-11 w-full border-t border-slate-100 px-4 text-left text-sm font-semibold text-cyan-800 hover:bg-slate-50" onClick={() => onNavigate("tasks", "today", mine, taskView)}>View all of today&apos;s {taskView} tasks →</button>
        </Card>
        <Card title="Meetings" action={<button className="min-h-10 text-sm font-semibold text-cyan-800 hover:underline" onClick={() => onAdd("meetings")}>+ Log meeting</button>}>
          <p className="flex min-h-11 items-center border-b border-slate-100 px-4 text-xs font-medium text-slate-500">Today · {data.meetingTotal} {data.meetingTotal === 1 ? "meeting" : "meetings"}</p>
          {data.meetings.length ? <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 px-4">{data.meetings.map(record => <button key={record.id} onClick={() => open(record)} className="flex w-full gap-4 py-4 text-left hover:bg-slate-50"><span className="w-20 shrink-0 text-sm font-semibold text-orange-800">{time(record.occurred_at)}</span><span className="min-w-0 border-l-2 border-orange-300 pl-4"><span className="block truncate text-sm font-semibold text-cyan-800">{recordTitle(record)}</span><span className="mt-1 block truncate text-xs capitalize text-slate-500">{ownerLabel(record.owner_email)}</span></span></button>)}</div> : <Empty type="meetings" title="No CRM meetings today">Meetings saved in HubSpot or Tools appear here.</Empty>}
          <p className="mt-auto flex min-h-11 items-center border-t border-slate-100 px-4 text-xs text-slate-400">Calendar not connected{data.meetingTotal > 8 ? " · First 8 meetings shown" : ""}</p>
        </Card>

      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <Card title="Activity feed" action={<select aria-label="Activity type" value={activity} onChange={event => setActivity(event.target.value as HomeActivity)} className="min-h-10 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600">{HOME_ACTIVITIES.map(type => <option key={type} value={type}>{type === "all" ? "All activity types" : ACTIVITY_NAMES[type] + "s"}</option>)}</select>}>
          {data.activities.length ? <div className="divide-y divide-slate-100 px-4">{data.activities.map(record => <button key={record.id} onClick={() => open(record)} className="flex w-full gap-3 py-3 text-left hover:bg-slate-50 sm:gap-4"><span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${record.object_type === "calls" ? "bg-emerald-50 text-emerald-700" : record.object_type === "emails" ? "bg-sky-50 text-sky-700" : "bg-orange-50 text-orange-700"}`}><Icon type={record.object_type} /></span><span className="min-w-0 flex-1"><span className="block text-xs text-slate-500">{ACTIVITY_NAMES[record.object_type]} · <span className="capitalize">{ownerLabel(record.owner_email)}</span></span><span className="mt-1 block break-words text-sm font-medium leading-relaxed text-cyan-900">{recordTitle(record)}</span><span className="mt-1 block text-xs text-slate-400">{stamp(record.occurred_at)}</span></span></button>)}</div> : <Empty type="notes" title="No saved activity in this view">{mine ? <button className="min-h-8 font-semibold text-cyan-800 hover:underline" onClick={() => setScope("team")}>Show team activity →</button> : "Calls, emails, meetings, notes, and tasks will appear here."}</Empty>}
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">Latest saved CRM activity. Email-open tracking is not connected.</p>
        </Card>
        <div className="space-y-4">
          <Card title="Metrics" action={<span className="text-xs text-slate-500">This week · {mine ? "My work" : "Team"}</span>}><div className="divide-y divide-slate-100 px-4">{([["contacts", "Contacts added"], ["calls", "Calls logged"], ["emails", "Emails logged"]] as const).map(([key, label]) => <div key={key} className="flex items-center justify-between gap-3 py-3"><span className="text-sm text-slate-600">{label}</span><span className="text-2xl font-semibold tabular-nums text-slate-900">{data.metrics[key].toLocaleString()}</span></div>)}</div></Card>
          <Card title="Needs attention"><div className="space-y-3 p-4">{data.tasks.overdue > 0 ? <button className="flex w-full items-center gap-3 rounded-lg bg-amber-50 p-3 text-left hover:bg-amber-100" onClick={() => onNavigate("tasks", "overdue", mine)}><span className="text-2xl font-semibold text-amber-900">{data.tasks.overdue.toLocaleString()}</span><span className="text-sm font-medium text-amber-900">Overdue {data.tasks.overdue === 1 ? "task" : "tasks"}<span className="mt-1 block text-xs font-normal text-amber-700">Due before today. Review follow-ups →</span></span></button> : <p className="text-sm text-emerald-800">No overdue tasks. You&apos;re caught up.</p>}{status?.sync?.last_error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-800">HubSpot import needs attention. Check the connection settings below.</p>}</div></Card>
          <Card title="Recent contacts" action={<button className="min-h-10 text-xs font-semibold text-cyan-800 hover:underline" onClick={() => onNavigate("contacts", "all", mine)}>View all →</button>}><div className="divide-y divide-slate-100 px-4">{data.contacts.map(record => <button key={record.id} onClick={() => open(record)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50"><RecordAvatar record={record} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-cyan-800">{recordTitle(record)}</span><span className="mt-1 block truncate text-xs text-slate-500">{stageLabel(record.view_fields?.stage)} · {stamp(record.occurred_at)}</span></span></button>)}{!data.contacts.length && <p className="py-4 text-sm text-slate-500">No contacts assigned in this view.</p>}</div></Card>
        </div>
      </div>
      <p className="text-xs text-slate-400">Times shown in {timeZone.replaceAll("_", " ")}. Updated {time(data.asOf)}.</p>
    </>}
  </div>;
}
