import { NextRequest, NextResponse } from "next/server";
import { recordCronRun, type CronStatus } from "@/lib/cron-monitor";

// The scheduled jobs, described for humans. `slug` is both the route segment
// under /api/cron/ and the value stored in cron_runs.job — keep them in sync
// with vercel.json.
export interface AutomationJob {
  slug: string;
  label: string;
  description: string;
  // The raw expression from vercel.json.
  cron: string;
  // Vercel runs crons on UTC, so the Toronto time these land at shifts by an
  // hour when daylight saving does.
  schedule: string;
}

export const AUTOMATION_JOBS: AutomationJob[] = [
  {
    slug: "sync-calls",
    label: "Call sync",
    description: "Pulls the previous day's phone records in so the Customer Service numbers are current.",
    cron: "0 12 * * *",
    schedule: "Every day, 12:00 UTC (about 8am Toronto)",
  },
  {
    slug: "sync-followup",
    label: "Follow-up sync",
    description: "Refreshes open quotes from Shopify so the follow-up list matches what's actually outstanding.",
    cron: "0 12 * * *",
    schedule: "Every day, 12:00 UTC (about 8am Toronto)",
  },
  {
    slug: "followup-reminders",
    label: "Follow-up reminders",
    description: "Emails each store the leads due or overdue for a follow-up that day.",
    cron: "0 13 * * 1-5",
    schedule: "Weekdays, 13:00 UTC (about 9am Toronto)",
  },
  {
    slug: "problems-digest",
    label: "Problem ticket digest",
    description: "Weekly summary of open problem tickets, so stale ones can't quietly rot.",
    cron: "0 13 * * 1",
    schedule: "Mondays, 13:00 UTC (about 9am Toronto)",
  },
  {
    slug: "send-employee-surveys",
    label: "Employee surveys",
    description: "Sends each active employee their weekly survey link.",
    cron: "0 14 * * 5",
    schedule: "Fridays, 14:00 UTC (about 10am Toronto)",
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
