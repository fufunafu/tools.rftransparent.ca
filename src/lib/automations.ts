import { NextRequest, NextResponse } from "next/server";
import { recordCronRun, type CronStatus } from "@/lib/cron-monitor";

// The scheduled jobs, described for humans. `slug` is both the route segment
// under /api/cron/ and the value stored in cron_runs.job — keep them in sync
// with vercel.json.
export interface AutomationJob {
  slug: string;
  label: string;
  description: string;
  kind: "sync" | "email";
  result: string;
  staleAfterHours: number;
  // The raw expression from vercel.json.
  cron: string;
  // Vercel runs crons on UTC, so the Toronto time these land at shifts by an
  // hour when daylight saving does.
  schedule: string;
  scheduleDetail: string;
  // Set when a manual run sends real mail to real people. Those get a
  // confirmation step — a mis-click shouldn't email every employee.
  sendsEmail?: string;
}

export const AUTOMATION_JOBS: AutomationJob[] = [
  {
    slug: "sync-calls",
    label: "Phone records import",
    description: "Copies CIK and Grasshopper call records into RF Tools.",
    kind: "sync",
    result: "Call history used by Customer Service metrics",
    staleAfterHours: 36,
    cron: "0 * * * *",
    schedule: "At the hours selected on the Phones page",
    scheduleDetail: "Hourly dispatcher checks the saved Eastern Time schedule",
  },
  {
    slug: "sync-followup",
    label: "Follow Up CRM import",
    description: "Copies open Shopify quotes into RF Tools as actionable CRM records.",
    kind: "sync",
    result: "CRM leads, statuses, and next follow-up dates",
    staleAfterHours: 36,
    cron: "0 12 * * *",
    schedule: "Daily, around 8:00 AM Toronto",
    scheduleDetail: "Scheduler starts at 12:00 UTC",
  },
  {
    slug: "sync-lead-quotes",
    label: "Lead quote matching",
    description: "Links website and Meta leads to the Shopify quotes and staff that followed them.",
    kind: "sync",
    result: "Quote, stage, and staff shown on the Leads page",
    staleAfterHours: 3,
    cron: "40 * * * *",
    schedule: "Hourly, around 40 minutes past the hour",
    scheduleDetail: "Reads the mirrored Shopify quotes; runs after the pipeline mirror",
  },
  {
    slug: "sync-emails",
    label: "Gmail activity import",
    description: "Copies the latest two weeks of Gmail activity into RF Tools.",
    kind: "sync",
    result: "Email history used by response analytics",
    staleAfterHours: 36,
    cron: "0 12 * * *",
    schedule: "Daily, around 8:00 AM Toronto",
    scheduleDetail: "Scheduler starts at 12:00 UTC",
  },
  {
    slug: "sync-pipeline",
    label: "Shopify pipeline mirror",
    description: "Incrementally copies changed Shopify orders and quotes into RF Tools.",
    kind: "sync",
    result: "Fast local data for pipeline metrics and forecasts",
    staleAfterHours: 3,
    cron: "15 * * * *",
    schedule: "Hourly, around 15 minutes past the hour",
    scheduleDetail: "Keeps pipeline history local so dashboards avoid full Shopify downloads",
  },
  {
    slug: "followup-reminders",
    label: "Follow-up reminders",
    description: "Sends each store its leads due or overdue that day.",
    kind: "email",
    result: "Sends to each store's follow-up inbox",
    staleAfterHours: 96,
    cron: "0 13 * * 1-5",
    schedule: "Weekdays, around 9:00 AM Toronto",
    scheduleDetail: "Scheduler starts at 13:00 UTC",
    sendsEmail: "each store's inbox",
  },
  {
    slug: "push-clock-reminders",
    label: "Clock-out reminders",
    description: "Pushes a \"Still clocked in?\" notification to phones once a shift passes 10 hours.",
    kind: "email",
    result: "One nudge per long-running shift, to the employee's phone",
    staleAfterHours: 2,
    cron: "*/30 * * * *",
    schedule: "Every 30 minutes",
    scheduleDetail: "Reminder window is 10-14 hours into a shift; past 14h the app asks for a real end time instead",
  },
  {
    slug: "push-followup-digest",
    label: "Follow-up digest (push)",
    description: "Pushes each sales rep their store's due and overdue follow-up counts every weekday morning.",
    kind: "email",
    result: "Morning phone notification for sales reps with the app installed",
    staleAfterHours: 96,
    cron: "5 13 * * 1-5",
    schedule: "Weekdays, around 9:05 AM Toronto",
    scheduleDetail: "Five minutes after the store-inbox email version",
  },
  {
    slug: "push-work-digest",
    label: "Task and callback digest (push)",
    description: "Pushes employees their due-task and assigned-callback counts every weekday morning.",
    kind: "email",
    result: "Morning phone notifications for employees with matching work and the app installed",
    staleAfterHours: 96,
    cron: "10 13 * * 1-5",
    schedule: "Weekdays, around 9:10 AM Toronto",
    scheduleDetail: "Five minutes after the follow-up push digest",
  },
  {
    slug: "problems-digest",
    label: "Problem ticket digest",
    description: "Sends a weekly summary of every open problem ticket.",
    kind: "email",
    result: "Sends to configured digest recipients",
    staleAfterHours: 192,
    cron: "0 13 * * 1",
    schedule: "Mondays, around 9:00 AM Toronto",
    scheduleDetail: "Scheduler starts at 13:00 UTC",
    sendsEmail: "the problem-ticket digest recipients",
  },
  {
    slug: "send-employee-surveys",
    label: "Employee survey program",
    description: "Dispatches weekly, quarterly, onboarding, exit, reminder, retention, and campaign-closing work in Toronto time.",
    kind: "email",
    result: "Sends to every active employee",
    staleAfterHours: 3,
    cron: "25 * * * *",
    schedule: "Hourly dispatcher; survey messages follow their Toronto schedule",
    scheduleDetail: "Weekly pulse Thursday afternoon, nonresponder reminder Monday morning, close Tuesday morning",
    sendsEmail: "survey recipients when a campaign or reminder is due",
  },
  {
    slug: "birthday-messages",
    label: "Employee birthday messages",
    description: "Sends birthday greetings and reminds coworkers to wish the birthday employee well.",
    kind: "email",
    result: "WhatsApp greeting to the birthday employee and reminders to active coworkers",
    staleAfterHours: 48,
    cron: "35 * * * *",
    schedule: "Daily, around 9:35 AM Toronto",
    scheduleDetail: "Hourly dispatcher handles daylight-saving changes and sends only during the 9 AM Toronto hour",
    sendsEmail: "the birthday employee and every other active employee",
  },
];

export function findJob(slug: string): AutomationJob | undefined {
  return AUTOMATION_JOBS.find((j) => j.slug === slug);
}

// Set by the "Run now" button so the history can distinguish a manual run
// from the scheduler firing.
export const TRIGGERED_BY_HEADER = "x-triggered-by";

// Off-hour dispatcher checks are expected no-ops. They should not displace
// the latest real import in automation history.
export const SKIP_RUN_HISTORY_HEADER = "x-skip-run-history";

/**
 * Wraps a cron route handler so every run lands in cron_runs. Recording is
 * best-effort inside recordCronRun, so this can't turn a working job into a
 * failing one — and the original response is always returned untouched.
 */
export function withCronRun(
  job: string,
  handler: (req: NextRequest) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const startedAt = Date.now();
    const triggeredBy = req.headers.get(TRIGGERED_BY_HEADER) ?? undefined;

    let res: NextResponse;
    try {
      res = await handler(req);
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      await recordCronRun(job, "error", detail, { startedAt, triggeredBy });
      throw err;
    }

    // A 401 is an unauthenticated probe, not a run — recording those would
    // fill the history with noise from anyone poking the public URL.
    if (res.status !== 401 && res.headers.get(SKIP_RUN_HISTORY_HEADER) !== "true") {
      const { status, detail } = await summarize(res);
      await recordCronRun(job, status, detail, { startedAt, triggeredBy });
    }
    return res;
  };
}

async function summarize(res: NextResponse): Promise<{ status: CronStatus; detail: string }> {
  let body: Record<string, unknown> | null = null;
  try {
    // clone() so the caller still gets an unread body.
    body = (await res.clone().json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const summary = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
    const errors = Array.isArray(body?.errors)
      ? body.errors.filter((error): error is string => typeof error === "string" && error.length > 0)
      : [];
    const message = errors.length > 0 ? `${summary}: ${errors.join("; ")}` : summary;
    return { status: "error", detail: message };
  }

  // Per-store jobs return 200 with a results array even when some entries
  // failed — those are the soft failures that already trigger an alert
  // email, so the history should call them errors too.
  const results = Array.isArray(body?.results) ? (body.results as { status?: string }[]) : null;
  if (results?.some((r) => r.status === "error")) {
    const failed = results.filter((r) => r.status === "error").length;
    return { status: "error", detail: `${failed}/${results.length} failed — ${JSON.stringify(body)}` };
  }

  // Several jobs report "skipped" in a 200 body when there was nothing to do.
  const reported = typeof body?.status === "string" ? body.status : null;
  return {
    status: reported === "skipped" ? "skipped" : "success",
    detail: body ? JSON.stringify(body) : "",
  };
}
