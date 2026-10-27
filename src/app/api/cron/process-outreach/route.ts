import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { withCronRun, SKIP_RUN_HISTORY_HEADER } from "@/lib/automations";
import { getOutreachConfig } from "@/lib/outreach/domain";
import { syncOutreachStaffMail } from "@/lib/outreach/staff-mail";
import { processOutreachEvents } from "@/lib/outreach/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

async function handler(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.OUTREACH_WORKER_ENABLED !== "true" || !getOutreachConfig()) {
    return NextResponse.json({ skipped: "Outreach worker is not enabled or configured" }, { headers: { [SKIP_RUN_HISTORY_HEADER]: "true" } });
  }
  try {
    const summary = await processOutreachEvents();
    const mail = await syncOutreachStaffMail();
    return NextResponse.json({ ...summary, mail }, { status: summary.errors || ("errors" in mail && mail.errors) ? 502 : 200 });
  } catch { return NextResponse.json({ error: "Outreach processing failed" }, { status: 503 }); }
}

export const GET = withCronRun("process-outreach", handler);
