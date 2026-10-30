import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { INBOXES, getGmailConnectionStatus } from "@/lib/gmail";
import { EMAIL_LEAD_INBOX, ingestEmailLeads } from "@/lib/customer-service/email-leads";
import { markLeadsCacheStale } from "@/lib/customer-service/lead-queries";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_DAYS = 3;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inbox = INBOXES.find((candidate) => candidate.email === EMAIL_LEAD_INBOX);
  if (!inbox || !(await getGmailConnectionStatus(inbox)).connected) {
    return NextResponse.json({ error: `${EMAIL_LEAD_INBOX} is not connected` }, { status: 503 });
  }

  // ?days=N backfills older notifications without emailing a new-lead alert
  // for each one. Scheduled runs only look at the last few days.
  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), 365) : DEFAULT_DAYS;
  const backfill = days > DEFAULT_DAYS;

  const result = await ingestEmailLeads({ days, maxMessages: backfill ? 500 : 100, notify: !backfill });
  if (result.inserted > 0 || result.merged > 0) markLeadsCacheStale();

  console.log("[Cron ingest-email-leads]", JSON.stringify(result));
  const body = { ...result, days, ingested_at: new Date().toISOString() };
  if (result.errors.length > 0) {
    return NextResponse.json({ ...body, error: `${result.errors.length} email lead(s) failed to save` }, { status: 500 });
  }
  return NextResponse.json(body);
}

// Every run, scheduled or manual, is recorded for /settings/automations.
export const GET = withCronRun("ingest-email-leads", handler);
