import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { getSupabase } from "@/lib/supabase";
import { processCrmProjections } from "@/lib/crm/projection.mjs";
import { sendCrmReminders } from "@/lib/crm/reminders";
import { captureCrmActivity } from "@/lib/crm/capture";
import { processCrmFollowups } from "@/lib/crm/followups.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
async function handler(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results: Record<string, unknown> = {};
  let failed = false;
  // Each queue has an independent durable lease. Large file transfers run
  // in the separate CRM file worker so they cannot delay staff reminders.
  for (const [name, run] of [
    ["reminders", () => sendCrmReminders()],
    ["index", () => processCrmProjections(getSupabase(), { budgetMs: 20000 })],
    ["activity", () => captureCrmActivity()],
    ["followups", () => processCrmFollowups(getSupabase(), { budgetMs: 20000 })],
  ] as const) {
    try {
      results[name] = await run();
      // Index and follow-up workers report database errors without throwing.
      if ((results[name] as { failed?: boolean } | undefined)?.failed) failed = true;
    } catch { results[name] = { error: "Worker paused; saved progress is retained." }; failed = true; }
  }
  return NextResponse.json({ results }, { status: failed ? 503 : 200 });
}
export const GET = withCronRun("crm-workflows", handler);
