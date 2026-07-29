import { getResend } from "@/lib/resend";
import { getSupabase } from "@/lib/supabase";
import { getNotificationSettings } from "@/lib/settings";

// Cron jobs run unattended and their errors previously only reached Vercel
// logs that nobody tails — a silently-broken sync or digest went unnoticed
// until the numbers looked stale. These helpers turn a failure into an email
// and record every run so /settings/automations can show what happened.
//
// Alerts go to the addresses on /settings/notifications, which default to
// CRON_ALERT_EMAIL and then the owner.

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

// Best-effort alert email. NEVER throws — alerting must not itself break a
// cron or mask the original error. A missing RESEND_API_KEY just logs.
export async function reportCronFailure(job: string, detail: string): Promise<void> {
  console.error(`[cron:${job}] ALERT: ${detail}`);
  try {
    const { cron_alerts } = await getNotificationSettings();
    await getResend().emails.send({
      from: "RF Tools <noreply@rftransparent.ca>",
      to: cron_alerts,
      subject: `⚠️ Cron failed: ${job}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
        <p>The <strong>${escapeHtml(job)}</strong> job reported a failure at ${new Date().toISOString()}.</p>
        <pre style="background:#f8fafc;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:12px">${escapeHtml(detail)}</pre>
      </div>`,
    });
  } catch (e) {
    console.error(`[cron:${job}] alert email also failed:`, e);
  }
}

// For crons that catch per-item errors into a results array and return 200:
// scan for soft failures and send one summary alert. Returns the failure
// count so the caller can include it in its response/logging.
export async function alertOnSoftFailures(
  job: string,
  results: { status: string; [k: string]: unknown }[]
): Promise<number> {
  const failed = results.filter((r) => r.status === "error");
  if (failed.length > 0) {
    await reportCronFailure(
      job,
      `${failed.length}/${results.length} item(s) failed:\n` +
        failed.map((r) => JSON.stringify(r)).join("\n")
    );
  }
  return failed.length;
}

export type CronStatus = "success" | "error" | "skipped";

export interface CronRun {
  job: string;
  status: CronStatus;
  detail: string | null;
  triggered_by: string | null;
  duration_ms: number | null;
  started_at: string;
}

/**
 * Write one run to the history table. Like the alert email, this NEVER
 * throws — a cron must not fail because its bookkeeping did, and the table
 * may not exist yet (migration 061 is applied by hand).
 */
export async function recordCronRun(
  job: string,
  status: CronStatus,
  detail: string,
  opts: { startedAt?: number; triggeredBy?: string } = {}
): Promise<void> {
  try {
    const startedAt = opts.startedAt ?? Date.now();
    await getSupabase().from("cron_runs").insert({
      job,
      status,
      // Long stack traces add nothing in a table cell.
      detail: detail.slice(0, 2000),
      triggered_by: opts.triggeredBy ?? null,
      duration_ms: Date.now() - startedAt,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[cron:${job}] could not record run:`, e);
  }

  // Retention is separate bookkeeping — it runs after the insert and swallows
  // its own errors, so a failing cleanup can never cost us the record itself.
  try {
    await pruneOldRuns();
  } catch (e) {
    console.error(`[cron:${job}] could not prune old runs:`, e);
  }
}

const RETENTION_DAYS = 90;

/**
 * Drop runs older than the retention window. Called on each insert — at five
 * jobs a day that's a handful of cheap deletes, and it means retention can't
 * silently stop working the way a separate scheduled cleanup could.
 */
async function pruneOldRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  await getSupabase().from("cron_runs").delete().lt("started_at", cutoff);
}

/**
 * Recent runs per job, newest first — what /settings/automations expands to
 * show. Same missing-table contract as getLatestCronRuns.
 */
export async function getCronRunHistory(
  jobs: string[],
  perJob = 10
): Promise<{ history: Record<string, CronRun[]>; tableMissing: boolean }> {
  try {
    const { data, error } = await getSupabase()
      .from("cron_runs")
      .select("job, status, detail, triggered_by, duration_ms, started_at")
      .in("job", jobs)
      .order("started_at", { ascending: false })
      // Enough rows that every job reaches its per-job cap even when one job
      // runs far more often than the rest.
      .limit(jobs.length * perJob * 4);

    if (error) return { history: {}, tableMissing: true };

    const history: Record<string, CronRun[]> = {};
    for (const row of (data ?? []) as CronRun[]) {
      const list = (history[row.job] ??= []);
      if (list.length < perJob) list.push(row);
    }
    return { history, tableMissing: false };
  } catch {
    return { history: {}, tableMissing: true };
  }
}

/**
 * Most recent run of each given job. Returns an empty map — not an error —
 * when the table is missing, so the page can tell the user to run the
 * migration instead of showing a stack trace.
 */
export async function getLatestCronRuns(
  jobs: string[]
): Promise<{ runs: Record<string, CronRun>; tableMissing: boolean }> {
  try {
    const { data, error } = await getSupabase()
      .from("cron_runs")
      .select("job, status, detail, triggered_by, duration_ms, started_at")
      .in("job", jobs)
      .order("started_at", { ascending: false })
      .limit(200);

    if (error) return { runs: {}, tableMissing: true };

    const runs: Record<string, CronRun> = {};
    for (const row of (data ?? []) as CronRun[]) {
      // Rows arrive newest-first, so the first sighting of a job wins.
      if (!runs[row.job]) runs[row.job] = row;
    }
    return { runs, tableMissing: false };
  } catch {
    return { runs: {}, tableMissing: true };
  }
}
