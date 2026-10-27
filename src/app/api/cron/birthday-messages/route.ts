import { NextRequest, NextResponse } from "next/server";
import {
  SKIP_RUN_HISTORY_HEADER,
  TRIGGERED_BY_HEADER,
  withCronRun,
} from "@/lib/automations";
import {
  isBirthdayDispatchHour,
  runBirthdayAutomation,
} from "@/lib/birthday-automation";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reportCronFailure } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handler(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const manualRun = Boolean(request.headers.get(TRIGGERED_BY_HEADER));
  const now = new Date();
  if (!manualRun && !isBirthdayDispatchHour(now)) {
    return NextResponse.json(
      { status: "skipped", reason: "outside the 9 AM Toronto dispatch hour" },
      { headers: { [SKIP_RUN_HISTORY_HEADER]: "true" } },
    );
  }

  try {
    const result = await runBirthdayAutomation(now);
    if (result.errors.length > 0) {
      const detail = `${result.errors.length} birthday message(s) failed:\n${result.errors.join("\n")}`;
      await reportCronFailure("birthday-messages", detail);
      return NextResponse.json(
        { ...result, error: `${result.errors.length} birthday message(s) failed` },
        { status: 502 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await reportCronFailure("birthday-messages", detail);
    return NextResponse.json({ error: "Birthday message automation failed" }, { status: 500 });
  }
}

export const GET = withCronRun("birthday-messages", handler);
