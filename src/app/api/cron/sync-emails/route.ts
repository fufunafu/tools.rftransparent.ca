import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { INBOXES, getGmailConnectionStatus } from "@/lib/gmail";
import { syncGmailInbox, type GmailSyncResult } from "@/lib/gmail-sync";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<GmailSyncResult | { inbox: string; status: "skipped"; error: string }> = [];

  for (const inbox of INBOXES) {
    const connection = await getGmailConnectionStatus(inbox);
    if (!connection.connected) {
      results.push({ inbox: inbox.email, status: "skipped", error: `${inbox.label} is not connected` });
      continue;
    }
    results.push(await syncGmailInbox(inbox));
  }

  console.log("[Cron sync-emails]", JSON.stringify(results));
  return NextResponse.json({ results, synced_at: new Date().toISOString() });
}

// Every run — scheduled or manual — is recorded for /settings/automations.
export const GET = withCronRun("sync-emails", handler);
