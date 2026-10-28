"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import type { CrmPage, CrmRecord } from "@/lib/crm/types";
import { directoryEdit } from "@/lib/crm/directory-workflows";
import { BUTTON, INPUT, PRIMARY, ErrorMessage, fetchJson, recordTitle, stageLabel } from "./shared";

const FIELD_LABELS = { title: "Name", email: "Email", phone: "Phone", company: "Company name", owner_email: "Owner email", website: "Website", domain: "Domain", address: "Street address", city: "City", region: "State / province", postal_code: "Postal / ZIP code", country: "Country" } as const;
export const LIFECYCLE_STAGES = ["subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer", "evangelist", "other"];
export default function DirectoryEditor({ record, onClose, onSaved }: { record: CrmRecord; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(record.id)}&view=fields`, fetchJson, { revalidateOnFocus: false });
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); }} aria-labelledby="directory-edit-title" className="max-h-[90dvh] w-[min(95vw,42rem)] overflow-y-auto rounded-xl p-0 shadow-2xl backdrop:bg-slate-950/40">
    {data ? <EditForm key={`${data.id}:${data.version}`} record={data} onClose={onClose} onSaved={onSaved} /> : <div className="space-y-4 p-6"><h2 id="directory-edit-title" className="text-xl font-bold">Edit {record.object_type === "companies" ? "company" : "contact"}</h2><ErrorMessage error={error} /><p role="status">{error ? "Could not load the current record." : "Loading current details..."}</p><button className={BUTTON} onClick={onClose}>Cancel</button>{error && <button className={BUTTON} onClick={() => void mutate()}>Retry</button>}</div>}
  </dialog>;
}
function EditForm({ record, onClose, onSaved }: { record: CrmRecord; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const [companySearch, setCompanySearch] = useState(""), [companyQuery, setCompanyQuery] = useState("");
  const [company, setCompany] = useState<CrmRecord | null>(null);
  useEffect(() => { const timeout = setTimeout(() => setCompanyQuery(companySearch.trim()), 300); return () => clearTimeout(timeout); }, [companySearch]);
  const { data: companies, error: companyError } = useSWR<CrmPage>(companyQuery.length >= 2 && !company ? `/api/crm?type=companies&q=${encodeURIComponent(companyQuery)}&page=0` : null, fetchJson);
  const source = record.properties ?? {};
  const fields: Record<string, unknown> = { address: source.address ?? "", website: source.website ?? "", postal_code: source.zip ?? "", ...record.view_fields, ...record.local_fields, title: record.title, owner_email: record.owner_email ?? "" };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries([...Object.keys(FIELD_LABELS), "stage"].map(key => [key, String(form.get(key) ?? fields[key] ?? "").trim()]));
    const parsed = directoryEdit.safeParse({ action: "editRecord", id: record.id, version: record.version, fields: values, companyId: company?.id ?? null });
    if (!parsed.success) { setError(new Error(parsed.error.issues[0]?.message ?? "Check the entered fields.")); return; }
    setBusy(true);
    try { await fetchJson("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error("Record could not be saved")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); } }} className="space-y-5 p-5 sm:p-6">
    <div><h2 id="directory-edit-title" className="text-xl font-bold text-slate-900">Edit {record.object_type === "companies" ? "company" : "contact"}</h2><p className="mt-1 text-xs text-slate-500">Changes are saved in Tools with your name in the change history.</p></div><ErrorMessage error={error} />
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">{Object.entries(FIELD_LABELS).filter(([key]) => record.object_type === "companies" ? !["email", "company"].includes(key) : key !== "domain").map(([key, label]) => <label key={key} className={`block text-sm font-medium text-slate-700 ${key === "title" || key === "address" ? "sm:col-span-2" : ""}`}>{label}<input name={key} type={key === "email" || key === "owner_email" ? "email" : key === "phone" ? "tel" : "text"} required={key === "title"} maxLength={key === "phone" ? 60 : ["email", "owner_email"].includes(key) ? 320 : ["title", "company"].includes(key) ? 300 : key === "postal_code" ? 40 : 500} defaultValue={String(fields[key] ?? "")} className={INPUT} />{key === "owner_email" && <span className="mt-1 block text-xs font-normal text-slate-500">Leave blank for unassigned.</span>}</label>)}
      <label className="block text-sm font-medium text-slate-700 sm:col-span-2">Lifecycle stage<select name="stage" defaultValue={String(fields.stage ?? "")} className={INPUT}><option value="">Not set</option>{[...new Set([...LIFECYCLE_STAGES, ...(fields.stage ? [String(fields.stage)] : [])])].map(value => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></label>
    </fieldset>
    {record.object_type === "contacts" && <fieldset disabled={busy} className="space-y-2 rounded-lg bg-slate-50 p-4"><legend className="text-sm font-semibold text-slate-800">Link an existing company</legend><p className="text-xs text-slate-500">Adds an association and updates the company name. Existing associations stay available.</p>{company ? <div className="flex items-center justify-between gap-2 text-sm"><span>{recordTitle(company)}</span><button type="button" className={BUTTON} onClick={() => setCompany(null)}>Remove selection</button></div> : <><label className="block text-xs text-slate-600">Find company<input type="search" value={companySearch} onChange={event => setCompanySearch(event.target.value)} className={INPUT} placeholder="Type at least 2 characters" /></label><ErrorMessage error={companyError} />{companyQuery.length >= 2 && !companies && !companyError && <p role="status" className="text-xs text-slate-500">Finding companies...</p>}{companies && <div className="max-h-44 overflow-auto">{companies.records.slice(0, 15).map(item => <button type="button" key={item.id} onClick={() => setCompany(item)} className="block min-h-10 w-full rounded p-2 text-left text-sm text-cyan-800 hover:bg-white">{recordTitle(item)}<span className="ml-2 text-xs text-slate-500">{item.view_fields?.domain}</span></button>)}{companies.total === 0 && <p className="py-2 text-xs text-slate-500">No matching companies</p>}{companies.total > 15 && <p className="py-2 text-xs text-slate-500">Keep typing to narrow the results.</p>}</div>}</>}</fieldset>}
    <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" disabled={busy} onClick={onClose} className={BUTTON}>Cancel</button><button disabled={busy} className={PRIMARY}>{busy ? "Saving..." : "Save changes"}</button></div>
  </form>;
}
