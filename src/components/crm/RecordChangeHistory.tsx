"use client";
import { useState } from "react";
import useSWR from "swr";
import type { CrmAuditEntry } from "@/lib/crm/directory-workflows";
import { BUTTON, ErrorMessage, fetchJson, ownerLabel, useDateLabel } from "./shared";
export default function RecordChangeHistory({ id }: { id: string }) {
  const [page, setPage] = useState(0);
  const dateLabel = useDateLabel();
  const { data, error, mutate } = useSWR<{ entries: CrmAuditEntry[]; total: number }>(`/api/crm/directory?history=${encodeURIComponent(id)}&page=${page}`, fetchJson);
  return <div className="mt-3 space-y-3"><ErrorMessage error={error} />{error && <button className={BUTTON} onClick={() => void mutate()}>Retry history</button>}{!data && !error && <p role="status" className="text-xs text-slate-500">Loading changes...</p>}{data?.entries.map(entry => {
    const before = entry.detail.before as Record<string, unknown> | undefined, after = entry.detail.after as Record<string, unknown> | undefined;
    return <article key={entry.id} className="rounded-lg border border-slate-200 p-3 text-xs"><p className="font-semibold capitalize text-slate-800">{entry.action.replaceAll("_", " ")}</p><p className="mt-1 text-slate-500">{ownerLabel(entry.actor_email)} · {dateLabel(entry.created_at)}</p>{after && <dl className="mt-2 space-y-1">{Object.entries(after).map(([key, value]) => <div key={key} className="break-words"><dt className="inline font-medium text-slate-600">{key.replaceAll("_", " ")}: </dt><dd className="inline text-slate-700">{String(before?.[key] ?? "") || "Not set"} → {String(value ?? "") || "Not set"}</dd></div>)}</dl>}{entry.action === "company_linked" && <p className="mt-2">{String(entry.detail.company ?? "Company linked")}</p>}{entry.action === "followup_created" && <p className="mt-2">{String(entry.detail.title ?? "Follow-up task")} · {dateLabel(String(entry.detail.dueAt ?? ""))}</p>}</article>;
  })}{data?.total === 0 && <p className="text-xs text-slate-500">No Tools changes recorded.</p>}{data && data.total > 25 && <div className="flex items-center justify-between gap-2"><button disabled={page === 0} onClick={() => setPage(page - 1)} className={BUTTON}>Previous</button><span className="text-xs text-slate-500">{page + 1} of {Math.ceil(data.total / 25)}</span><button disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(page + 1)} className={BUTTON}>Next</button></div>}</div>;
}
