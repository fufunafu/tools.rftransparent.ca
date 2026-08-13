import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import {
  pipelineMirrorHistoryStart,
  syncPipelineShopifyMirror,
} from "@/lib/pipeline-shopify-mirror";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fromDate = pipelineMirrorHistoryStart(new Date());
  const summary = await syncPipelineShopifyMirror(fromDate, { force: true });
  return NextResponse.json({ status: "success", ...summary });
}

export const GET = withCronRun("sync-pipeline", handler);
