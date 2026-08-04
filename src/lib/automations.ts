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
    cron: "0 12 * * *",
    schedule: "Daily, around 8:00 AM Toronto",
    scheduleDetail: "Scheduler starts at 12:00 UTC",
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
    label: "Employee surveys",
    description: "Sends every active employee a unique weekly survey link.",
    kind: "email",
    result: "Sends to every active employee",
    staleAfterHours: 192,
    cron: "0 14 * * 5",
    schedule: "Fridays, around 10:00 AM Toronto",
    scheduleDetail: "Scheduler starts at 14:00 UTC",
    sendsEmail: "every active employee",
  },
];

export function findJob(slug: string): AutomationJob | undefined {
  return AUTOMATION_JOBS.find((j) => j.slug === slug);
}

// Set by the "Run now" button so the history can distinguish a manual run
// from the scheduler firing.
export const TRIGGERED_BY_HEADER = "x-triggered-by";

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
    if (res.status !== 401) {
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
    const message = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
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
