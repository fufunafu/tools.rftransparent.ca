import { NextRequest, NextResponse } from "next/server";
import {
  SKIP_RUN_HISTORY_HEADER,
  TRIGGERED_BY_HEADER,
  withCronRun,
} from "@/lib/automations";
import { getSupabase } from "@/lib/supabase";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { alertOnSoftFailures } from "@/lib/cron-monitor";
import { syncLeadCallStatuses, type LeadCallSyncSummary } from "@/lib/lead-call-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STORES = ["bc_transparent", "rf_transparent"];
const SCRAPER_TIMEOUT_MS = 210_000;

interface ScraperTarget {
  scraper: "cik" | "grasshopper";
  path: string;
  store?: string;
}

interface ScraperResult {
  [key: string]: unknown;
  scraper: string;
  store?: string;
  status: string;
  detail?: string;
}

async function runScraper(
  scraperUrl: string,
  headers: Record<string, string>,
  target: ScraperTarget,
): Promise<ScraperResult> {
  try {
    const res = await fetch(`${scraperUrl}${target.path}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(SCRAPER_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null) as {
      status?: string;
      records_inserted?: number;
      error?: string;
    } | null;
    return {
      scraper: target.scraper,
      ...(target.store ? { store: target.store } : {}),
      status: json?.status || (res.ok ? "ok" : "error"),
      detail: json?.records_inserted != null
        ? `${json.records_inserted} records`
        : json?.error || (!res.ok ? `HTTP ${res.status}` : undefined),
    };
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      scraper: target.scraper,
      ...(target.store ? { store: target.store } : {}),
      status: "error",
      detail: timedOut
        ? `Timed out after ${Math.round(SCRAPER_TIMEOUT_MS / 1000)} seconds`
        : error instanceof Error ? error.message : "fetch failed",
    };
  }
}

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protected maintenance path for the initial backfill or a manual repair.
  // Normal scheduled runs reach the same sync after importing phone records.
  if (req.nextUrl.searchParams.get("mode") === "lead-status") {
    const summary = await syncLeadCallStatuses();
    return NextResponse.json({
      status: "success",
      lead_call_sync: summary,
      synced_at: new Date().toISOString(),
    });
  }

  // Scheduled runs obey the saved time window. A person pressing "Run sync"
  // expects an immediate refresh, so manual runs intentionally bypass it.
  const isManualRun = Boolean(req.headers.get(TRIGGERED_BY_HEADER));
  if (!isManualRun) {
    const { data: settingsRow } = await getSupabase()
      .from("app_settings")
      .select("value")
      .eq("key", "sync_schedule")
      .limit(1);

    const schedule = settingsRow?.[0]?.value ?? {
      enabled: true,
      hours: [8, 11, 14, 17],
      timezone: "America/New_York",
    };
    if (!schedule.enabled) {
      return NextResponse.json({ skipped: true, reason: "Auto-sync is disabled" });
    }

    const tz = schedule.timezone || "America/New_York";
    const currentHour = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false });
    const hour = parseInt(currentHour, 10);

    if (!schedule.hours.includes(hour)) {
      return NextResponse.json(
        { skipped: true, reason: `Current hour ${hour} not in schedule [${schedule.hours}]` },
        { headers: { [SKIP_RUN_HISTORY_HEADER]: "true" } },
      );
    }
  }

  const scraperUrl = process.env.SCRAPER_URL;
  const scraperKey = process.env.SCRAPER_API_KEY;
  if (!scraperUrl) {
    return NextResponse.json({ error: "SCRAPER_URL not configured" }, { status: 503 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (scraperKey) {
    headers["Authorization"] = `Bearer ${scraperKey}`;
  }

  // These imports are independent. Running them together keeps the manual
  // sync within the route duration even when Grasshopper takes 2-3 minutes.
  const targets: ScraperTarget[] = [
    ...STORES.map((store) => ({ scraper: "cik" as const, store, path: `/scrape?store=${store}` })),
    { scraper: "grasshopper", path: "/scrape-grasshopper" },
  ];
  const results = await Promise.all(
    targets.map((target) => runScraper(scraperUrl, headers, target)),
  );

  let leadCallSync: LeadCallSyncSummary | null = null;
  try {
    leadCallSync = await syncLeadCallStatuses();
    results.push({
      scraper: "lead-call-matching",
      status: "ok",
      detail: `${leadCallSync.called} called, ${leadCallSync.noAnswer} no answer, ${leadCallSync.phonesRecovered} phones recovered`,
    });
  } catch (err) {
    results.push({
      scraper: "lead-call-matching",
      status: "error",
      detail: err instanceof Error ? err.message : "lead call matching failed",
    });
  }

  console.log("[Cron sync-calls]", JSON.stringify(results));
  await alertOnSoftFailures("sync-calls", results);
  return NextResponse.json({ results, lead_call_sync: leadCallSync, synced_at: new Date().toISOString() });
}

// Every run — scheduled or manual — is recorded for /settings/automations.
export const GET = withCronRun("sync-calls", handler);
