import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { startOfDayInTimeZone } from "@/lib/dates";
import { apnsConfigured, deadTokens, sendPush } from "@/lib/apns";
import { followupDigestText, scopeForEmployeeLocationName } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Morning follow-ups digest, pushed to sales employees' phones. Counts are
// per store scope: a Toronto rep hears about Toronto's leads, Quebec about
// Quebec's. Mirrors the store-inbox email that runs five minutes earlier —
// the phone version is for the reps, the email for the shared inbox.

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!apnsConfigured()) {
    return NextResponse.json({ skipped: true, reason: "APNs not configured" });
  }

  const sb = getSupabase();
  const now = new Date();
  const todayStart = startOfDayInTimeZone(now).toISOString();
  const tomorrowStart = startOfDayInTimeZone(now, undefined, 1).toISOString();

  // Due/overdue counts per follow-up store.
  const storeCounts = new Map<string, { due: number; overdue: number }>();
  const { data: dueLeads, error: dueError } = await sb
    .from("followup_leads")
    .select("store_id")
    .is("closed_at", null)
    .gte("next_followup_at", todayStart)
    .lt("next_followup_at", tomorrowStart);
  if (dueError) throw new Error(dueError.message);
  const { data: overdueLeads, error: overdueError } = await sb
    .from("followup_leads")
    .select("store_id")
    .is("closed_at", null)
    .not("next_followup_at", "is", null)
    .lt("next_followup_at", todayStart);
  if (overdueError) throw new Error(overdueError.message);
  for (const l of dueLeads ?? []) {
    const c = storeCounts.get(l.store_id) ?? { due: 0, overdue: 0 };
    c.due++;
    storeCounts.set(l.store_id, c);
  }
  for (const l of overdueLeads ?? []) {
    const c = storeCounts.get(l.store_id) ?? { due: 0, overdue: 0 };
    c.overdue++;
    storeCounts.set(l.store_id, c);
  }

  // Sales employees with registered devices, scoped by their location.
  const { data: reps, error: repsError } = await sb
    .from("employees")
    .select("id, department, locations(name)")
    .eq("active", true)
    .eq("department", "sales");
  if (repsError) throw new Error(repsError.message);

  const { data: tokens, error: tokenError } = await sb
    .from("push_tokens")
    .select("token, employee_id")
    .is("disabled_at", null);
  if (tokenError) throw new Error(tokenError.message);
  const tokensByEmployee = new Map<string, string[]>();
  for (const t of tokens ?? []) {
    tokensByEmployee.set(t.employee_id, [...(tokensByEmployee.get(t.employee_id) ?? []), t.token]);
  }

  let notified = 0;
  const dead: string[] = [];
  for (const rep of reps ?? []) {
    const employeeTokens = tokensByEmployee.get(rep.id) ?? [];
    if (employeeTokens.length === 0) continue;

    const locations = rep.locations as { name: string } | { name: string }[] | null;
    const locationName = Array.isArray(locations) ? locations[0]?.name ?? null : locations?.name ?? null;
    const scope = scopeForEmployeeLocationName(locationName);
    const storeIds = scope?.shopifyStoreIds ?? [...storeCounts.keys()];

    let due = 0;
    let overdue = 0;
    for (const id of storeIds) {
      const c = storeCounts.get(id);
      if (c) {
        due += c.due;
        overdue += c.overdue;
      }
    }
    const text = followupDigestText(due, overdue);
    if (!text) continue;

    const results = await sendPush(employeeTokens, { ...text, url: "/customer-service/follow-up" });
    dead.push(...deadTokens(results));
    if (results.some((r) => r.ok)) notified++;
  }

  if (dead.length > 0) {
    await sb.from("push_tokens").update({ disabled_at: now.toISOString() }).in("token", dead);
  }

  return NextResponse.json({ status: "success", notified, deadTokens: dead.length });
}

export const GET = withCronRun("push-followup-digest", handler);
