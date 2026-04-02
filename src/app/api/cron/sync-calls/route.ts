import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STORES = ["bc_transparent", "rf_transparent"];

export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if sync is enabled and current hour matches the schedule
  const { data: settingsRow } = await getSupabase()
    .from("app_settings")
    .select("value")
    .eq("key", "sync_schedule")
    .limit(1);

  const schedule = settingsRow?.[0]?.value ?? { enabled: true, hours: [8, 17], timezone: "America/New_York" };
  if (!schedule.enabled) {
    return NextResponse.json({ skipped: true, reason: "Auto-sync is disabled" });
  }

  const tz = schedule.timezone || "America/New_York";
  const currentHour = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  const hour = parseInt(currentHour, 10);

  if (!schedule.hours.includes(hour)) {
    return NextResponse.json({ skipped: true, reason: `Current hour ${hour} not in schedule [${schedule.hours}]` });
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

  const results: { scraper: string; store?: string; status: string; detail?: string }[] = [];

  // CIK scraper — one call per store
  for (const store of STORES) {
    try {
      const res = await fetch(`${scraperUrl}/scrape?store=${store}`, { method: "POST", headers });
      const json = await res.json();
      results.push({
        scraper: "cik",
        store,
        status: json.status || (res.ok ? "ok" : "error"),
        detail: json.records_inserted != null ? `${json.records_inserted} records` : json.error,
      });
    } catch (err) {
      results.push({
        scraper: "cik",
        store,
        status: "error",
        detail: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }

  // Grasshopper scraper — single call covers all stores
  try {
    const res = await fetch(`${scraperUrl}/scrape-grasshopper`, { method: "POST", headers });
    const json = await res.json();
    results.push({
      scraper: "grasshopper",
      status: json.status || (res.ok ? "ok" : "error"),
      detail: json.records_inserted != null ? `${json.records_inserted} records` : json.error,
    });
  } catch (err) {
    results.push({
      scraper: "grasshopper",
      status: "error",
      detail: err instanceof Error ? err.message : "fetch failed",
    });
  }

  console.log("[Cron sync-calls]", JSON.stringify(results));
  return NextResponse.json({ results, synced_at: new Date().toISOString() });
}
