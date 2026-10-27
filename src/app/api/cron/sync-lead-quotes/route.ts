import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { getStores } from "@/lib/shopify";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { alertOnSoftFailures } from "@/lib/cron-monitor";
import { syncLeadQuotesFromFollowups } from "@/lib/lead-quote-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Lead ↔ Shopify quote matching used to run only at the tail of the daily
// Follow Up CRM import. That import regularly exceeds its 300 s budget, which
// meant the matching step never ran. This job only reads the already-mirrored
// followup_leads rows, so it finishes in seconds and can run hourly.
async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeIds = getStores().map((store) => store.id);
  const results: { store_id: string; label: string; status: string; detail?: string }[] = [];
  let summary = null;
  try {
    summary = await syncLeadQuotesFromFollowups(storeIds);
    results.push({
      store_id: "lead_quote_matching",
      label: "Lead quote matching",
      status: summary.errors > 0 ? "error" : "ok",
      detail: `${summary.linked} linked, ${summary.quoted} quoted, ${summary.won} won, ${summary.staffAssigned} staff assigned, ${summary.errors} errors`,
    });
  } catch (err) {
    results.push({
      store_id: "lead_quote_matching",
      label: "Lead quote matching",
      status: "error",
      detail: err instanceof Error ? err.message : "lead quote matching failed",
    });
  }

  console.log("[Cron sync-lead-quotes]", JSON.stringify(results));
  await alertOnSoftFailures("sync-lead-quotes", results);
  return NextResponse.json({ results, lead_quote_sync: summary, synced_at: new Date().toISOString() });
}

export const GET = withCronRun("sync-lead-quotes", handler);
