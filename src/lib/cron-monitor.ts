import { getResend } from "@/lib/resend";
import { OWNER_EMAIL } from "@/lib/authz";

// Cron jobs run unattended and their errors previously only reached Vercel
// logs that nobody tails — a silently-broken sync or digest went unnoticed
// until the numbers looked stale. These helpers turn a failure into an email.
//
// Alerts go to CRON_ALERT_EMAIL, falling back to the owner. Set that env var
// to redirect them without touching code.
const ALERT_TO = process.env.CRON_ALERT_EMAIL || OWNER_EMAIL;

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

// Best-effort alert email. NEVER throws — alerting must not itself break a
// cron or mask the original error. A missing RESEND_API_KEY just logs.
export async function reportCronFailure(job: string, detail: string): Promise<void> {
  console.error(`[cron:${job}] ALERT: ${detail}`);
  try {
    await getResend().emails.send({
      from: "RF Tools <noreply@rftransparent.ca>",
      to: ALERT_TO,
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
