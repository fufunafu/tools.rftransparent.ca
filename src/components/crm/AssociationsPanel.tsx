"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { CrmAssociation } from "@/lib/crm/search";
import { CRM_LABELS, type CrmPage, type CrmRecord, type CrmType } from "@/lib/crm/types";
import RecordAvatar from "./RecordAvatar";
import { crmAction } from "./actions";
import { ErrorMessage, INPUT, cleanSummary, fetchJson, recordTitle } from "./shared";

const LINKABLE: Partial<Record<CrmType, ("contacts" | "companies")[]>> = { contacts: ["companies"], companies: ["contacts"], calls: ["contacts", "companies"], meetings: ["contacts", "companies"], emails: ["contacts", "companies"], notes: ["contacts", "companies"], tasks: ["contacts", "companies"] };

/** Linked contacts and companies. Staff can add links and remove the ones added in Tools. */
export default function AssociationsPanel({ record, onSelect, onCreate, onChanged }: {
  record: CrmRecord; onSelect: (id: string) => void; onCreate?: (type: CrmType) => void; onChanged?: () => void;
}) {
  const key = `/api/crm/associations?record=${encodeURIComponent(record.id)}`;
  const { data, error, mutate } = useSWR<{ records: CrmAssociation[] }>(key, fetchJson);
  const [adding, setAdding] = useState<"contacts" | "companies" | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const linkable = record.archived ? [] : LINKABLE[record.object_type] ?? [];
  async function change(action: "link" | "unlink", other: string) {
    setActionError(null);
    try { await crmAction({ action, fromId: record.id, toId: other }); setAdding(null); await mutate(); onChanged?.(); }
    catch (cause) { setActionError(cause instanceof Error ? cause : new Error("Could not update the association")); }
  }
  return <div className="space-y-5"><ErrorMessage error={error} /><ErrorMessage error={actionError} />
    {(["contacts", "companies"] as const).map(type => {
      const records = data?.records.filter(item => item.object_type === type) ?? [];
      return <section key={type} aria-label={`Associated ${CRM_LABELS[type].toLowerCase()}`}>
        <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-800">{CRM_LABELS[type]} <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{data ? records.length : "..."}</span></h3>
          {linkable.includes(type) && <div className="flex gap-1">{onCreate && record.object_type === "companies" && type === "contacts" && <button className="min-h-8 rounded px-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-50" onClick={() => onCreate("contacts")}>+ New</button>}<button className="min-h-8 rounded px-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-50" aria-expanded={adding === type} onClick={() => setAdding(adding === type ? null : type)}>{adding === type ? "Cancel" : "+ Add"}</button></div>}
        </div>
        {adding === type && <RecordPicker type={type} exclude={new Set([record.id, ...records.map(item => item.id)])} onPick={picked => void change("link", picked.id)} />}
        {records.map(item => <div key={item.id} className="mb-2 flex items-start gap-2 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
          <button onClick={() => onSelect(item.id)} className="min-w-0 flex-1 text-left"><span className="flex items-center gap-2"><RecordAvatar record={item} /><span className="min-w-0 truncate text-sm font-semibold text-cyan-800">{recordTitle(item)}</span></span><span className="mt-1 block truncate text-xs text-slate-500">{item.view_fields?.email || cleanSummary(item.summary)}</span></button>
          {item.removable && !record.archived && <button aria-label={`Remove association with ${item.title}`} title="Remove association" onClick={() => void change("unlink", item.id)} className="min-h-8 rounded px-2 text-xs text-slate-400 hover:bg-red-50 hover:text-red-700">Remove</button>}
        </div>)}
        {data && !records.length && <p className="text-xs text-slate-400">No associated {type}</p>}
      </section>;
    })}
    {data && data.records.some(item => !item.removable) && <p className="text-[11px] text-slate-400">Associations imported from HubSpot can&apos;t be removed here.</p>}
  </div>;
}

export function RecordPicker({ type, exclude = new Set(), onPick, autoFocus = true }: { type: "contacts" | "companies"; exclude?: Set<string>; onPick: (record: CrmRecord) => void; autoFocus?: boolean }) {
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const { data, error } = useSWR<CrmPage>(query.length >= 2 ? `/api/crm?type=${type}&q=${encodeURIComponent(query)}&page=0` : null, fetchJson);
  const results = data?.records.filter(item => !exclude.has(item.id)).slice(0, 8) ?? [];
  return <div className="mb-3 rounded-lg bg-slate-50 p-3">
    <label className="block text-xs text-slate-600">Find {type === "contacts" ? "a contact" : "a company"}<input autoFocus={autoFocus} type="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Type at least 2 characters" className={INPUT} /></label>
    <ErrorMessage error={error} />
    {query.length >= 2 && !data && !error && <p role="status" className="mt-2 text-xs text-slate-500">Searching...</p>}
    <div className="mt-2 max-h-56 overflow-auto">{results.map(item => <button type="button" key={item.id} onClick={() => onPick(item)} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-white"><RecordAvatar record={item} /><span className="min-w-0"><span className="block truncate font-semibold text-cyan-800">{recordTitle(item)}</span><span className="block truncate text-xs text-slate-500">{item.view_fields?.email || item.view_fields?.domain || cleanSummary(item.summary)}</span></span></button>)}
      {data && !results.length && <p className="py-2 text-xs text-slate-500">No matching {type}.</p>}</div>
  </div>;
}
