import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { alertOnSoftFailures } from "@/lib/cron-monitor";
import { syncShippingQuotes } from "@/lib/shipping-quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every 15 minutes: find unfulfilled Shopify orders with a shipping address
// that have no Freightcom quote yet, and get one. Each quote is an async
// rate search (~5–20 s), so a run caps how many it takes on; the next run
// picks up the rest.
async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: { store_id: string; label: string; status: string; detail?: string }[] = [];
  let summary = null;
  try {
    summary = await syncShippingQuotes({ maxQuotes: 12 });
    const detail = summary.reason
      ? summary.reason
      : `${summary.scanned} orders scanned, ${summary.quoted} quoted, ${summary.skipped} pickup/skipped, ${summary.errors} errors`;
    results.push({
      store_id: "shipping_quotes",
      label: "Freightcom quotes",
      status: summary.reason ? "skipped" : summary.errors > 0 ? "error" : "ok",
      detail,
    });
  } catch (err) {
    results.push({
      store_id: "shipping_quotes",
      label: "Freightcom quotes",
      status: "error",
      detail: err instanceof Error ? err.message : "shipping quote sync failed",
    });
  }

  console.log("[Cron sync-shipping-quotes]", JSON.stringify(results));
  await alertOnSoftFailures("sync-shipping-quotes", results);
  return NextResponse.json({ results, summary, synced_at: new Date().toISOString() });
}

export const GET = withCronRun("sync-shipping-quotes", handler);
