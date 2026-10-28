"use client";
import useSWR from "swr";
import type { CrmRecord } from "@/lib/crm/types";
import { fetchJson, useDateLabel, useNow } from "./shared";

type Summary = Pick<CrmRecord, "last_contacted_at" | "next_task_id" | "next_task_title" | "next_task_due_at" | "open_task_count" | "followup_checked_at">;

/** Last contacted, next task and open task count for a contact or company. */
export default function FollowupSummary({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const dateLabel = useDateLabel();
  const now = useNow();
  const { data, error } = useSWR<{ summary: Summary | null }>(`/api/crm/associations?summary=${encodeURIComponent(id)}`, fetchJson);
  if (error) return null;
  const summary = data?.summary;
  const pending = !data || !summary?.followup_checked_at;
  const overdue = now > 0 && summary?.next_task_due_at && Date.parse(summary.next_task_due_at) < now;
  return <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs" aria-label="Follow-up summary" aria-busy={!data}>
    <div><dt className="text-slate-500">Last contacted</dt><dd className="mt-1 font-semibold text-slate-800">{pending ? "Updating..." : summary?.last_contacted_at ? dateLabel(summary.last_contacted_at) : "Never"}</dd></div>
    <div><dt className="text-slate-500">Open tasks</dt><dd className="mt-1 font-semibold text-slate-800">{pending ? "..." : summary?.open_task_count ?? 0}</dd></div>
    <div className="col-span-2"><dt className="text-slate-500">Next task</dt><dd className="mt-1">{pending ? <span className="text-slate-400">Updating...</span> : summary?.next_task_id
      ? <button onClick={() => onSelect(summary.next_task_id!)} className="text-left font-semibold text-cyan-800 hover:underline">{summary.next_task_title || "Follow-up"} <span className={`block font-normal ${overdue ? "text-red-700" : "text-slate-500"}`}>{overdue ? "Overdue · " : ""}{dateLabel(summary.next_task_due_at ?? null)}</span></button>
      : <span className="text-slate-500">No open task. Schedule one so this customer isn&apos;t forgotten.</span>}</dd></div>
  </dl>;
}
