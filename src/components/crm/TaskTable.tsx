"use client";
import { useState } from "react";
import useSWR from "swr";
import type { CrmRecord } from "@/lib/crm/types";
import { activityChips } from "@/lib/crm/productivity";
import QuickComplete from "./QuickComplete";
import { ErrorMessage, SINGLE, SourceBadge, cleanSummary, fetchJson, ownerLabel, recordTitle, useDateLabel, useNow } from "./shared";

type Labels = Record<string, { id: string; title: string; object_type: string }[]>;

/** Task list with the customer each task is about and one-click completion. */
export default function TaskTable({ records, email, canManage, onSelect, onChanged }: {
  records: CrmRecord[]; email: string; canManage: boolean; onSelect: (id: string) => void; onChanged: () => void;
}) {
  const dateLabel = useDateLabel();
  const [error, setError] = useState<Error | null>(null);
  const ids = records.map(record => record.id).join(",");
  const { data } = useSWR<{ labels: Labels }>(ids ? `/api/crm/associations?ids=${encodeURIComponent(ids)}` : null, fetchJson, { revalidateOnFocus: false });
  const now = useNow();
  return <><div className="px-4"><ErrorMessage error={error} /></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><tr><th scope="col" className="w-12 px-4 py-3"><span className="sr-only">Complete</span></th>{["Task", "Associated with", "Assigned to", "Due date"].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
    <tbody className="divide-y divide-slate-100">{records.map(record => {
      const done = record.effective_task_status === "completed";
      const late = !done && now > 0 && record.effective_due_at && Date.parse(record.effective_due_at) < now;
      const links = data?.labels[record.id] ?? [];
      const chips = activityChips(record);
      return <tr key={`${record.id}:${record.version}`} className="hover:bg-orange-50/40">
        <td className="px-4 py-3"><QuickComplete record={record} email={email} canManage={canManage} onChanged={onChanged} onError={setError} /></td>
        <td className="max-w-80 px-4 py-3"><button onClick={() => onSelect(record.id)} className={`text-left font-semibold hover:underline ${done ? "text-slate-500 line-through" : "text-cyan-800"}`}>{recordTitle(record)}</button>{record.source === "tools" && <span className="ml-2"><SourceBadge source={record.source} /></span>}
          <div className="mt-1 flex flex-wrap items-center gap-1">{chips.map(chip => <span key={chip} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.startsWith("High") ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-600"}`}>{chip}</span>)}<span className="truncate text-xs text-slate-500">{record.view_fields?.preview || cleanSummary(record.summary)}</span></div></td>
        <td className="max-w-56 px-4 py-3 text-xs">{links.length ? links.map(link => <button key={link.id} onClick={() => onSelect(link.id)} className="block max-w-56 truncate text-left font-medium text-cyan-800 hover:underline">{link.title}<span className="ml-1 text-slate-400">{SINGLE[link.object_type as CrmRecord["object_type"]]}</span></button>) : <span className="text-slate-400">{data ? "Not linked" : "..."}</span>}</td>
        <td className="whitespace-nowrap px-4 py-3 text-xs capitalize text-slate-600">{ownerLabel(record.owner_email)}</td>
        <td className={`whitespace-nowrap px-4 py-3 text-xs ${late ? "font-semibold text-red-700" : "text-slate-500"}`}>{late ? "Overdue · " : ""}{dateLabel(record.effective_due_at)}{done && <span className="ml-1 text-emerald-700">· Completed</span>}</td>
      </tr>;
    })}</tbody>
  </table></div></>;
}
