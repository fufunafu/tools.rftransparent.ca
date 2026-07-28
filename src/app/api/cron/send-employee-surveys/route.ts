import { NextRequest, NextResponse } from "next/server";
import { sendSurveys } from "@/lib/employee-surveys";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendSurveys();
  return NextResponse.json(result);
}
