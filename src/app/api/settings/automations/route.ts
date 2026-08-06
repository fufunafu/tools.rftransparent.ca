import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getLatestCronRuns } from "@/lib/cron-monitor";
import { AUTOMATION_JOBS, findJob, TRIGGERED_BY_HEADER } from "@/lib/automations";
import { getAutomationDetailFailure } from "@/lib/automation-status";

export const dynamic = "force-dynamic";
// A manual sync can take a while; give it the same room the cron gets.
export const maxDuration = 300;

export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { runs, tableMissing } = await getLatestCronRuns(AUTOMATION_JOBS.map((j) => j.slug));
  return NextResponse.json({ jobs: AUTOMATION_JOBS, runs, tableMissing });
}

// "Run now". Admin-only: these jobs send real email to real customers and
// staff, so being able to read the page isn't enough to fire one.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { job?: string } | null;
  const job = body?.job ? findJob(body.job) : undefined;
  if (!job) return NextResponse.json({ error: "Unknown job" }, { status: 400 });

  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so jobs can't be triggered." },
      { status: 500 }
    );

  // Call the cron route over HTTP rather than importing its handler, so the
  // run goes through exactly the same path the scheduler uses.
  const url = new URL(`/api/cron/${job.slug}`, req.nextUrl.origin);
  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${secret}`,
        [TRIGGERED_BY_HEADER]: user.email ?? "unknown",
      },
      cache: "no-store",
    });
    const detail = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `${job.label} failed (HTTP ${res.status})`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }
    const detailFailure = getAutomationDetailFailure(detail);
    if (detailFailure) {
      return NextResponse.json(
        { error: `${job.label} finished with issues: ${detailFailure}`, detail: detail.slice(0, 500) },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, detail: detail.slice(0, 500) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach the job" },
      { status: 502 }
    );
  }
}
