import "server-only";
import { getSupabase } from "@/lib/supabase";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { CrmInputError } from "./input";
import { effectiveRecord, SUMMARY_COLUMNS } from "./data";
import { HOME_ACTIVITIES, homeWindow, type CrmHomeData, type HomeScope } from "./home-window";
import type { CrmRecord } from "./types";

export async function getCrmHome(email: string, params = new URLSearchParams(), now = new Date()): Promise<CrmHomeData> {
  const timeZone = params.get("timeZone") ?? BUSINESS_TIMEZONE;
  const scope = params.get("scope") ?? "mine";
  const activity = params.get("activity") ?? "all";
  if (!["mine", "team"].includes(scope) || !HOME_ACTIVITIES.includes(activity as never) || timeZone.length > 80) throw new CrmInputError("Invalid Home view");
  let window;
  try { window = homeWindow(now, timeZone); } catch { throw new CrmInputError("Invalid time zone"); }
  const db = getSupabase();
  const base = (countOnly = false, withTotal = true) => {
    let query = db.from("crm_records").select(countOnly ? "id" : SUMMARY_COLUMNS, countOnly ? { count: "exact", head: true } : withTotal ? { count: "exact" } : {}).eq("archived", false);
    if (scope === "mine") query = query.eq("owner_email", email.toLowerCase());
    return query;
  };
  const tasks = (status: string) => base().eq("object_type", "tasks").eq("effective_task_status", status)
    .gte("effective_due_at", window.dayStart).lt("effective_due_at", window.dayEnd)
    .order("effective_due_at", { ascending: true, nullsFirst: false }).order("id").limit(8);
  const weekly = (type: string) => base(true).eq("object_type", type).gte("occurred_at", window.weekStart).lte("occurred_at", now.toISOString());
  // Only compact indexed summaries reach Home. Original bodies, fields, and
  // history stay deferred until a record is opened.
  const results = await Promise.all([
    tasks("open"), tasks("completed"),
    base(true).eq("object_type", "tasks").eq("effective_task_status", "open").lt("effective_due_at", window.dayStart),
    base().eq("object_type", "meetings").gte("occurred_at", window.dayStart).lt("occurred_at", window.dayEnd)
      .order("occurred_at", { ascending: true, nullsFirst: false }).order("id").limit(8),
    base(false, false).in("object_type", activity === "all" ? ["emails", "calls", "meetings", "notes", "tasks"] : [activity])
      .lte("occurred_at", now.toISOString()).order("occurred_at", { ascending: false, nullsFirst: false }).order("id").limit(15),
    base(false, false).eq("object_type", "contacts").order("occurred_at", { ascending: false, nullsFirst: false }).order("id").limit(6),
    weekly("contacts"), weekly("calls"), weekly("emails"),
  ]);
  if (results.some(result => result.error)) throw new Error("Home could not load. Please try again.");
  const records = (index: number) => (results[index].data as unknown as CrmRecord[] ?? []).map(effectiveRecord);
  const count = (index: number) => results[index].count ?? 0;
  return {
    asOf: now.toISOString(), timeZone, scope: scope as HomeScope, ...window,
    tasks: { open: records(0), completed: records(1), openTotal: count(0), completedTotal: count(1), overdue: count(2) },
    meetings: records(3), meetingTotal: count(3), activities: records(4), contacts: records(5),
    metrics: { contacts: count(6), calls: count(7), emails: count(8) },
  };
}
