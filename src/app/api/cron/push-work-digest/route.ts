import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { dayKeyInTimeZone } from "@/lib/time-clock";
import { getSupabase } from "@/lib/supabase";
import { apnsConfigured, deadTokens, sendRegisteredPush } from "@/lib/apns";
import {
  callbackDigestText,
  overdueDigestText,
  taskDigestText,
  taskDueBucket,
} from "@/lib/push-notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!apnsConfigured()) {
    return NextResponse.json({ skipped: true, reason: "APNs not configured" });
  }

  const sb = getSupabase();
  const today = dayKeyInTimeZone(new Date(), BUSINESS_TIMEZONE);
  const [tasksResult, callbacksResult, tokensResult] = await Promise.all([
    sb
      .from("todos")
      .select("created_by, due_at")
      .eq("completed", false)
      .not("due_at", "is", null)
      .lte("due_at", today),
    sb
      .from("callback_notes")
      .select("assigned_to")
      .neq("status", "done")
      .not("assigned_to", "is", null),
    sb
      .from("push_tokens")
      .select("token, user_email, task_updates, overdue_updates, callback_updates, apns_environment")
      .is("disabled_at", null),
  ]);
  if (tasksResult.error) throw new Error(tasksResult.error.message);
  if (callbacksResult.error) throw new Error(callbacksResult.error.message);
  if (tokensResult.error) throw new Error(tokensResult.error.message);

  const taskCounts = new Map<string, number>();
  const overdueCounts = new Map<string, number>();
  for (const task of tasksResult.data ?? []) {
    const email = String(task.created_by ?? "").toLowerCase();
    const bucket = taskDueBucket(task.due_at, today);
    if (!email || !bucket) continue;
    const counts = bucket === "due" ? taskCounts : overdueCounts;
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  const callbackCounts = new Map<string, number>();
  for (const callback of callbacksResult.data ?? []) {
    const email = String(callback.assigned_to ?? "").toLowerCase();
    if (email) callbackCounts.set(email, (callbackCounts.get(email) ?? 0) + 1);
  }

  let notifications = 0;
  const dead: string[] = [];
  for (const token of tokensResult.data ?? []) {
    const email = String(token.user_email ?? "").toLowerCase();
    const messages = [
      token.task_updates
        ? { text: taskDigestText(taskCounts.get(email) ?? 0), url: "/todos", category: "RF_TASK" as const }
        : null,
      token.overdue_updates
        ? { text: overdueDigestText(overdueCounts.get(email) ?? 0), url: "/todos", category: "RF_OVERDUE" as const }
        : null,
      token.callback_updates
        ? { text: callbackDigestText(callbackCounts.get(email) ?? 0), url: "/customer-service#callbacks", category: "RF_CALLBACK" as const }
        : null,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item?.text));

    for (const message of messages) {
      const results = await sendRegisteredPush([{
        token: token.token,
        apns_environment: token.apns_environment === "sandbox" ? "sandbox" : "production",
      }], {
        ...message.text!,
        url: message.url,
        category: message.category,
      });
      dead.push(...deadTokens(results));
      if (results.some((result) => result.ok)) notifications += 1;
    }
  }

  if (dead.length > 0) {
    await sb
      .from("push_tokens")
      .update({ disabled_at: new Date().toISOString() })
      .in("token", [...new Set(dead)]);
  }

  return NextResponse.json({ status: "success", notifications, deadTokens: dead.length });
}

export const GET = withCronRun("push-work-digest", handler);
