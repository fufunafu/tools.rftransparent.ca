import type { CrmRecord, CrmType } from "@/lib/crm/types";
import { useSyncExternalStore } from "react";

export const INPUT = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100";
export const BUTTON = "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
export const PRIMARY = "min-h-11 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50";
export const ACTIVITIES: CrmType[] = ["notes", "calls", "meetings", "emails", "tasks"];
export const SINGLE: Record<CrmType, string> = { contacts: "Contact", companies: "Company", deals: "Deal", tickets: "Ticket", calls: "Call", meetings: "Meeting", emails: "Email", notes: "Note", tasks: "Task" };

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  let data;
  try { data = await response.json(); } catch { throw new Error("Unable to reach Tools. Please try again."); }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function localInput(value = new Date()): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
const dateFormatter = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" });
const serverDateFormatter = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const subscribeToNothing = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
function dateLabel(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "No date";
}
function serverDateLabel(value: string | null) {
  return value ? `${serverDateFormatter.format(new Date(value))} UTC` : "No date";
}
export function useDateLabel() {
  // Server locations can differ from the viewer's time zone. Hydrate the same
  // text first, then display local dates without discarding the rendered list.
  return useSyncExternalStore(subscribeToNothing, clientSnapshot, serverSnapshot) ? dateLabel : serverDateLabel;
}
// One shared clock for "overdue" labels. It ticks once a minute and is 0 on
// the server, so nothing is marked overdue until the page is in the browser.
let nowSnapshot = Date.now();
function subscribeNow(onChange: () => void) {
  nowSnapshot = Date.now(); onChange();
  const timer = setInterval(() => { nowSnapshot = Date.now(); onChange(); }, 60_000);
  return () => clearInterval(timer);
}
export function useNow() {
  return useSyncExternalStore(subscribeNow, () => nowSnapshot, () => 0);
}
export function SourceBadge({ source }: { source: CrmRecord["source"] }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${source === "tools" ? "bg-emerald-50 text-emerald-800" : "bg-orange-50 text-orange-800"}`}>{source === "tools" ? "Tools" : "HubSpot"}</span>;
}
export function ErrorMessage({ error }: { error?: Error | null }) {
  return error ? <p role="alert" className="my-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error.message}</p> : null;
}
export function Pager({ page, total, onPage, busy = false }: { page: number; total: number; busy?: boolean; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
    <span>{total ? `${page * 50 + 1} to ${Math.min((page + 1) * 50, total)} of ${total.toLocaleString()}` : "0 records"}</span>
    <div className="flex gap-2"><button className={BUTTON} disabled={busy || page === 0} onClick={() => onPage(page - 1)}>Previous</button><button className={BUTTON} disabled={busy || (page + 1) * 50 >= total} onClick={() => onPage(page + 1)}>Next</button></div>
  </div>;
}

export function cleanSummary(value: string | undefined) {
  return (value ?? "").split(" · ").filter(part => !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(part.trim())).join(" · ");
}
export function stageLabel(value: string | undefined) {
  const labels: Record<string, string> = { subscriber: "Subscriber", lead: "Lead", marketingqualifiedlead: "Marketing qualified", salesqualifiedlead: "Sales qualified", opportunity: "Opportunity", customer: "Customer", evangelist: "Advocate", other: "Other" };
  if (!value || /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) || /^\d+$/.test(value)) return "Not set";
  return labels[value] || value.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}
export function ownerLabel(value: string | null | undefined) { return value ? value.split("@")[0].replace(/[._]/g, " ") : "Unassigned"; }

export function recordTitle(record: Pick<CrmRecord, "source" | "object_type" | "title">) {
  if (record.source === "hubspot" && new RegExp(`^${record.object_type} \\d+$`).test(record.title)) return `Untitled ${SINGLE[record.object_type].toLowerCase()}`;
  return record.title;
}
