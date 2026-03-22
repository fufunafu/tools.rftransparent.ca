import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { STORES as SHOPIFY_STORES } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CheckResult {
  name: string;
  status: "ok" | "error" | "slow" | "unconfigured";
  latency_ms: number;
  detail?: string;
}

interface FreshnessRow {
  source: string;
  store_id: string;
  latest_call: string | null;
  last_scrape: string | null;
  scrape_status: string | null;
  stale: boolean;
}

async function timedCheck(
  name: string,
  fn: () => Promise<string | undefined>,
  timeoutMs = 30000
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)
      ),
    ]);
    const latency = Date.now() - start;
    return {
      name,
      status: latency > 3000 ? "slow" : "ok",
      latency_ms: latency,
      detail,
    };
  } catch (err) {
    return {
      name,
      status: "error",
      latency_ms: Date.now() - start,
      detail: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function envCheck(name: string, vars: string[]): CheckResult {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length === 0) {
    return { name, status: "ok", latency_ms: 0, detail: `${vars.length} vars set` };
  }
  return {
    name,
    status: missing.length === vars.length ? "unconfigured" : "error",
    latency_ms: 0,
    detail: `Missing: ${missing.join(", ")}`,
  };
}

// Define all service checks
function getServiceCheck(name: string): (() => Promise<CheckResult>) | null {
  switch (name) {
    case "supabase":
      return () => timedCheck("Supabase", async () => {
        const { data, error } = await getSupabase()
          .from("call_records")
          .select("id")
          .limit(1);
        if (error) throw new Error(error.message);
        return `Connected (${data?.length ?? 0} test rows)`;
      });

    case "scraper":
      return () => timedCheck("Scraper (Render)", async () => {
        const url = process.env.SCRAPER_URL;
        if (!url) throw new Error("SCRAPER_URL not set");
        const res = await fetch(`${url}/health`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const storeCount = json.stores?.length ?? 0;
        return `${json.status} — ${storeCount} stores`;
      }, 55000); // Longer timeout for cold-start on free tier

    case "google-ads":
      return () => timedCheck("Google Ads", async () => {
        const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
        if (!clientId || !clientSecret || !refreshToken) throw new Error("Not configured");
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
          }),
        });
        if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
        return "Token OK";
      });

    case "google-analytics":
      return () => timedCheck("Google Analytics", async () => {
        const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID;
        const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
        const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
        if (!propertyId || !clientId || !clientSecret || !refreshToken)
          throw new Error("Not configured");
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
          }),
        });
        if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenRes.status}`);
        const { access_token } = await tokenRes.json();
        const today = new Date().toISOString().split("T")[0];
        const reportRes = await fetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${access_token}`,
            },
            body: JSON.stringify({
              dateRanges: [{ startDate: today, endDate: today }],
              metrics: [{ name: "sessions" }],
            }),
          }
        );
        if (!reportRes.ok) throw new Error(`Report failed: ${reportRes.status}`);
        const report = await reportRes.json();
        const sessions = report.rows?.[0]?.metricValues?.[0]?.value ?? "0";
        return `${sessions} sessions today`;
      });

    default:
      // Shopify stores
      if (name.startsWith("shopify-")) {
        const idx = parseInt(name.replace("shopify-", ""), 10);
        const store = SHOPIFY_STORES[idx];
        if (!store) return null;
        return () => timedCheck(`Shopify: ${store.label}`, async () => {
          const res = await fetch(
            `https://${store.store}/admin/oauth/access_token`,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: store.clientId,
                client_secret: store.clientSecret,
              }),
            }
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return "Token OK";
        });
      }
      return null;
  }
}

export async function GET(req: NextRequest) {
  const checkName = req.nextUrl.searchParams.get("check");

  // Single check mode — returns one CheckResult
  if (checkName) {
    const checkFn = getServiceCheck(checkName);
    if (!checkFn) {
      return NextResponse.json({ name: checkName, status: "error", latency_ms: 0, detail: "Unknown check" });
    }
    const result = await checkFn();
    return NextResponse.json(result);
  }

  // Full check mode — env vars + data freshness (fast, no external calls)
  const envChecks: CheckResult[] = [
    envCheck("Supabase Env", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]),
    envCheck("Shopify Env", ["SHOPIFY_STORE_1", "SHOPIFY_CLIENT_ID_1", "SHOPIFY_CLIENT_SECRET_1"]),
    envCheck("Google Ads Env", ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_DEVELOPER_TOKEN"]),
    envCheck("GA4 Env", ["GOOGLE_GA4_PROPERTY_ID"]),
    envCheck("Anthropic Env", ["ANTHROPIC_API_KEY"]),
    envCheck("OpenAI Env", ["OPENAI_API_KEY"]),
    envCheck("Resend Env", ["RESEND_API_KEY"]),
    envCheck("Scraper Env", ["SCRAPER_URL", "SCRAPER_API_KEY"]),
  ];

  // Data freshness
  const freshness: FreshnessRow[] = [];
  const staleThresholdMs = 48 * 60 * 60 * 1000;
  const stores = ["bc_transparent", "rf_transparent"];
  const sources = ["cik", "grasshopper"];

  for (const storeId of stores) {
    for (const source of sources) {
      const { data: latestCall } = await getSupabase()
        .from("call_records")
        .select("call_start")
        .eq("store_id", storeId)
        .eq("source", source)
        .order("call_start", { ascending: false })
        .limit(1);

      const { data: lastRun } = await getSupabase()
        .from("scraper_runs")
        .select("finished_at,status")
        .eq("store_id", storeId)
        .eq("status", "success")
        .order("finished_at", { ascending: false })
        .limit(1);

      const latestCallTime = latestCall?.[0]?.call_start ?? null;
      const lastScrapeTime = lastRun?.[0]?.finished_at ?? null;
      const scrapeStatus = lastRun?.[0]?.status ?? null;

      const isStale = latestCallTime
        ? Date.now() - new Date(latestCallTime).getTime() > staleThresholdMs
        : true;

      freshness.push({
        source,
        store_id: storeId,
        latest_call: latestCallTime,
        last_scrape: lastScrapeTime,
        scrape_status: scrapeStatus,
        stale: isStale,
      });
    }
  }

  // List of service checks the frontend should call individually
  const serviceChecks = [
    "supabase",
    "scraper",
    ...SHOPIFY_STORES.map((_, i) => `shopify-${i}`),
    "google-ads",
    "google-analytics",
  ];

  return NextResponse.json({
    service_checks: serviceChecks,
    env_vars: envChecks,
    data_freshness: freshness,
    checked_at: new Date().toISOString(),
  });
}
