import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { withCronRun, SKIP_RUN_HISTORY_HEADER } from "@/lib/automations";
import { runCrmFileWorker } from "@/lib/crm/file-worker";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
async function handler(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runCrmFileWorker();
    return NextResponse.json(result, { status: "workerErrors" in result && result.workerErrors ? 503 : 200, ...("skipped" in result ? { headers: { [SKIP_RUN_HISTORY_HEADER]: "true" } } : {}) });
  } catch { return NextResponse.json({ error: "CRM file copies paused. Verified files and queued references are retained." }, { status: 503 }); }
}
export const GET = withCronRun("crm-files", handler);
