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
