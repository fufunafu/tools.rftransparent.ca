import { NextRequest, NextResponse } from "next/server";
import { TRIGGERED_BY_HEADER, withCronRun } from "@/lib/automations";
import { runSurveyAutomation } from "@/lib/employee-surveys";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reportCronFailure } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSurveyAutomation(new Date(), {
      forcePeriodic: Boolean(req.headers.get(TRIGGERED_BY_HEADER)),
    });
    const errors = [
      ...result.campaigns.flatMap((campaign) => campaign.errors),
      ...result.reminders.errors,
    ];
    if (errors.length > 0) {
      const detail = `${errors.length} survey message(s) failed:\n${errors.join("\n")}`;
      await reportCronFailure("send-employee-surveys", detail);
      return NextResponse.json(
        { ...result, errors, error: `${errors.length} survey message(s) failed` },
        { status: 502 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await reportCronFailure("send-employee-surveys", detail);
    return NextResponse.json({ error: "Survey send failed" }, { status: 500 });
  }
}

// Every run — scheduled or manual — is recorded for /settings/automations.
export const GET = withCronRun("send-employee-surveys", handler);
