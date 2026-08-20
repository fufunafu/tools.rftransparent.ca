import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { apnsConfigured, deadTokens, sendPush } from "@/lib/apns";
import { clockReminderText, shiftNeedsReminder } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Still clocked in?" — one push per shift once it passes 10 hours. Past 14
// hours the shift goes stale and the app itself asks for a real end time, so
// this only covers the window where a quick tap still fixes everything.

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!apnsConfigured()) {
    return NextResponse.json({ skipped: true, reason: "APNs not configured" });
  }

  const sb = getSupabase();
  const now = new Date();

  const { data: openShifts, error } = await sb
    .from("time_entries")
    .select("id, employee_id, clock_in_at, clock_out_at, reminder_sent_at")
    .is("clock_out_at", null)
    .is("reminder_sent_at", null);
  if (error) throw new Error(error.message);

  const due = (openShifts ?? []).filter((shift) => shiftNeedsReminder(shift, now));
  if (due.length === 0) {
    return NextResponse.json({ status: "success", reminded: 0 });
  }

  const { data: tokens, error: tokenError } = await sb
    .from("push_tokens")
    .select("token, employee_id")
    .in("employee_id", due.map((s) => s.employee_id))
    .is("disabled_at", null);
  if (tokenError) throw new Error(tokenError.message);

  const tokensByEmployee = new Map<string, string[]>();
  for (const t of tokens ?? []) {
    tokensByEmployee.set(t.employee_id, [...(tokensByEmployee.get(t.employee_id) ?? []), t.token]);
  }

  let reminded = 0;
  const dead: string[] = [];
  for (const shift of due) {
    const employeeTokens = tokensByEmployee.get(shift.employee_id) ?? [];
    if (employeeTokens.length > 0) {
      const results = await sendPush(employeeTokens, {
        ...clockReminderText(shift.clock_in_at, now),
        url: "/clock",
      });
      dead.push(...deadTokens(results));
      if (results.some((r) => r.ok)) reminded++;
    }
    // Mark even token-less shifts so each shift is considered exactly once.
    const { error: markError } = await sb
      .from("time_entries")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", shift.id)
      .is("clock_out_at", null);
    if (markError) throw new Error(markError.message);
  }

  if (dead.length > 0) {
    await sb
      .from("push_tokens")
      .update({ disabled_at: now.toISOString() })
      .in("token", dead);
  }

  return NextResponse.json({ status: "success", eligible: due.length, reminded, deadTokens: dead.length });
}

export const GET = withCronRun("push-clock-reminders", handler);
