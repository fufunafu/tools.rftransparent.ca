import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { sendSurveys } from "@/lib/employee-surveys";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reportCronFailure } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendSurveys();
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await reportCronFailure("send-employee-surveys", detail);
    return NextResponse.json({ error: "Survey send failed" }, { status: 500 });
  }
}

// Every run — scheduled or manual — is recorded for /settings/automations.
export const GET = withCronRun("send-employee-surveys", handler);
