import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { STORES as SHOPIFY_STORES, shopifyGraphQL } from "@/lib/shopify";
import { checkGmailInbox, getGmailConnectionStatus, INBOXES } from "@/lib/gmail";
import { isAuthenticated } from "@/lib/admin-auth";
import { getMetaConnectionStatus } from "@/lib/customer-service/meta-leads";
import { getAdMetrics } from "@/lib/google-ads";
import { getAutomationHealth, type AutomationHealth } from "@/lib/home-dashboard";
import { getWallToken } from "@/lib/settings";
import { BUG_BUCKET } from "@/lib/bug-reports";
import { LEAD_ATTACHMENT_BUCKET } from "@/lib/customer-service/lead-attachments";
import { checkWhatsAppConnection } from "@/lib/whatsapp";
import { checkResendHealth } from "@/lib/resend";

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

interface EmailFreshnessRow {
  inbox: string;
  label: string;
  last_sync: string | null;
  stale: boolean;
}

// Tables the app reads on hot paths. Several callers deliberately swallow a
// missing table (api-cache, settings), so a dropped one degrades invisibly
// everywhere except here.
const CORE_TABLES = [
  "app_settings",
  "api_cache",
  "cron_runs",
  "call_records",
  "email_messages",
  "employees",
  "followup_leads",
  "leads",
  "lead_attachments",
  "problem_tickets",
  "bug_reports",
];

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
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      name,
      // "Not configured" is a setup state, not an outage — keep the two
      // distinguishable on the dashboard.
      status: message === "Not configured" ? "unconfigured" : "error",
      latency_ms: Date.now() - start,
      detail: message,
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

// Shopify env can't be a flat var list: each store needs its host plus EITHER
// a shpat_ access token OR the OAuth pair (shopify.ts makes the pair optional).
// A store whose env vanishes also disappears from STORES — and with it from
// the services grid — so this is the only place that still notices.
function shopifyEnvCheck(): CheckResult {
  const problems: string[] = [];
  let configured = 0;
  for (let i = 1; i <= 3; i++) {
    const host = process.env[`SHOPIFY_STORE_${i}`];
    const hasAuth = Boolean(
      process.env[`SHOPIFY_ACCESS_TOKEN_${i}`] ||
        (process.env[`SHOPIFY_CLIENT_ID_${i}`] && process.env[`SHOPIFY_CLIENT_SECRET_${i}`])
    );
    if (!host) {
      problems.push(`SHOPIFY_STORE_${i} missing`);
    } else if (!hasAuth) {
      problems.push(`store ${i}: host set but no access token or OAuth pair`);
    } else {
      configured++;
    }
  }
  if (configured === 0) {
    return { name: "Shopify Env", status: "unconfigured", latency_ms: 0, detail: problems.join("; ") };
  }
  if (problems.length > 0) {
    return { name: "Shopify Env", status: "error", latency_ms: 0, detail: problems.join("; ") };
  }
  return { name: "Shopify Env", status: "ok", latency_ms: 0, detail: "3 stores configured" };
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

    case "tables":
      return () => timedCheck("Core Tables", async () => {
        const missing: string[] = [];
        await Promise.all(
          CORE_TABLES.map(async (table) => {
            const { error } = await getSupabase()
              .from(table)
              .select("*", { count: "exact", head: true });
            if (error) missing.push(table);
          })
        );
        if (missing.length > 0) throw new Error(`Unreadable: ${missing.join(", ")}`);
        return `${CORE_TABLES.length} tables readable`;
      });

    case "storage":
      return () => timedCheck("Supabase Storage", async () => {
        const buckets = [BUG_BUCKET, LEAD_ATTACHMENT_BUCKET];
        const results = await Promise.all(
          buckets.map((bucket) => getSupabase().storage.getBucket(bucket)),
        );
        const missing = buckets.filter((_, index) => results[index].error);
        if (missing.length > 0) throw new Error(`Missing bucket: ${missing.join(", ")}`);
        return `${buckets.join(", ")} OK`;
      });

    case "scraper":
      return () => timedCheck("Scraper (Render)", async () => {
        const url = process.env.SCRAPER_URL;
        if (!url) throw new Error("Not configured");
        // Send the same bearer the real callers send, so an auth regression
        // fails here and not just at 12:00 UTC.
        const apiKey = process.env.SCRAPER_API_KEY;
        const res = await fetch(`${url}/health`, {
          cache: "no-store",
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const storeCount = json.stores?.length ?? 0;
        return `${json.status} — ${storeCount} stores`;
      }, 55000); // Longer timeout for cold-start on free tier

    case "google-ads":
      return () => timedCheck("Google Ads", async () => {
        if (
          !process.env.GOOGLE_ADS_CLIENT_ID ||
          !process.env.GOOGLE_ADS_CLIENT_SECRET ||
          !process.env.GOOGLE_ADS_REFRESH_TOKEN ||
          !process.env.GOOGLE_ADS_CUSTOMER_ID ||
          !process.env.GOOGLE_ADS_DEVELOPER_TOKEN
        )
          throw new Error("Not configured");
        // Real Ads API query, not just the OAuth handshake — the developer
        // token and customer id can be wrong while the token still refreshes.
        const today = new Date().toISOString().split("T")[0];
        const metrics = await getAdMetrics(today, today);
        return `API OK — $${Math.round(metrics.ad_spend)} spend today`;
      });

    case "resend":
      return () => timedCheck("Resend", checkResendHealth);

    case "meta":
      return () => timedCheck("Meta Lead Forms", async () => {
        const status = await getMetaConnectionStatus();
        if (!status.configured) throw new Error("Not configured");
        if (!status.connected || status.error) throw new Error(status.error ?? "Not connected");
        return `${status.page_name ?? "Page"} connected, leadgen subscribed`;
      });

    case "whatsapp":
      return () => timedCheck("WhatsApp Cloud API", checkWhatsAppConnection);

    case "wall":
      return () => timedCheck("Wall Board Token", async () => {
        const token = await getWallToken();
        if (!token) throw new Error("No wall token set — the office TV board 404s");
        return "Token set";
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
      // Gmail inboxes — one check per inbox, indexed like shopify-N
      if (name.startsWith("gmail-")) {
        const idx = parseInt(name.replace("gmail-", ""), 10);
        const inbox = INBOXES[idx];
        if (!inbox) return null;
        return () => timedCheck(`Gmail: ${inbox.label}`, () => checkGmailInbox(inbox));
      }
      // Shopify stores — probe via a real API call ({ shop { name } })
      // rather than re-running the OAuth exchange. This works for both
      // client_credentials custom apps and shpat_ access-token custom apps.
      if (name.startsWith("shopify-quotation-")) {
        const idx = parseInt(name.replace("shopify-quotation-", ""), 10);
        const store = SHOPIFY_STORES[idx];
        if (!store) return null;
        return () => timedCheck(`Shopify Quotes: ${store.label}`, async () => {
          if (!store.quotationAccessToken) throw new Error("Not configured");
          const data = await shopifyGraphQL<{ shop: { name: string } }>(
            store.id,
            "{ shop { name } }",
            undefined,
            { app: "quotation" }
          );
          return `Connected: ${data.shop.name}`;
        });
      }
      if (name.startsWith("shopify-")) {
        const idx = parseInt(name.replace("shopify-", ""), 10);
        const store = SHOPIFY_STORES[idx];
        if (!store) return null;
        return () => timedCheck(`Shopify: ${store.label}`, async () => {
          const data = await shopifyGraphQL<{ shop: { name: string } }>(
            store.id,
            "{ shop { name } }"
          );
          return `Connected: ${data.shop.name}`;
        });
      }
      return null;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    envCheck("Supabase Env", [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      // Missing anon key = the proxy bounces every visitor to /login.
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]),
    shopifyEnvCheck(),
    envCheck("Google Ads Env", ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_DEVELOPER_TOKEN"]),
    envCheck("GA4 Env", ["GOOGLE_GA4_PROPERTY_ID"]),
    envCheck("Resend Env", ["RESEND_API_KEY"]),
    envCheck("Scraper Env", ["SCRAPER_URL", "SCRAPER_API_KEY"]),
    envCheck("Gmail Env", ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"]),
    envCheck("Meta Env", ["META_PAGE_ACCESS_TOKEN", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN"]),
    envCheck("WhatsApp Env", [
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_SURVEY_TEMPLATE_NAME",
    ]),
    // CRON_SECRET missing means every scheduled job 401s — and those 401s are
    // deliberately not recorded, so cron_runs just goes quiet.
    envCheck("Cron & Webhook Secrets", ["CRON_SECRET", "LEADS_WEBHOOK_SECRET"]),
    envCheck("App URLs", ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"]),
  ];

  // Data freshness
  const freshness: FreshnessRow[] = [];
  const staleThresholdMs = 48 * 60 * 60 * 1000;
  // glass_railing_store has no phone lines — calls exist for these two only.
  const stores = ["bc_transparent", "rf_transparent"];
  const sources = ["cik", "grasshopper"];

  for (const storeId of stores) {
    // One scraper run covers both sources for a store, and a run that FAILED
    // still counts as the latest run — filtering to status=success here used
    // to show a green timestamp from whenever the last success was, however
    // long ago the scraper actually broke.
    const { data: lastRun } = await getSupabase()
      .from("scraper_runs")
      .select("finished_at,status")
      .eq("store_id", storeId)
      .order("started_at", { ascending: false })
      .limit(1);

    const lastScrapeTime = lastRun?.[0]?.finished_at ?? null;
    const scrapeStatus = lastRun?.[0]?.status ?? null;

    for (const source of sources) {
      const { data: latestCall } = await getSupabase()
        .from("call_records")
        .select("call_start")
        .eq("store_id", storeId)
        .eq("source", source)
        .order("call_start", { ascending: false })
        .limit(1);

      const latestCallTime = latestCall?.[0]?.call_start ?? null;
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

  // Email sync freshness
  const emailFreshness: EmailFreshnessRow[] = [];
  for (const inbox of INBOXES) {
    const { data: lastSync } = await getSupabase()
      .from("email_sync_runs")
      .select("finished_at")
      .eq("inbox", inbox.email)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1);

    const lastSyncTime = lastSync?.[0]?.finished_at ?? null;
    const isStale = lastSyncTime
      ? Date.now() - new Date(lastSyncTime).getTime() > staleThresholdMs
      : true;

    emailFreshness.push({
      inbox: inbox.email,
      label: inbox.label,
      last_sync: lastSyncTime,
      stale: isStale,
    });
  }

  // Scheduled jobs — same failing/silent/never-run analysis the home page's
  // attention strip uses, shown here with the rest of the system's health.
  const automationResult = await getAutomationHealth();
  const automations: AutomationHealth | null = automationResult.ok ? automationResult.value : null;
  const gmailConnections = await Promise.all(
    INBOXES.map(async (inbox, index) => ({
      id: `gmail-${index}`,
      label: inbox.label,
      ...(await getGmailConnectionStatus(inbox)),
    })),
  );

  // List of service checks the frontend should call individually
  const serviceChecks = [
    "supabase",
    "tables",
    "storage",
    "scraper",
    ...SHOPIFY_STORES.map((_, i) => `shopify-${i}`),
    ...SHOPIFY_STORES.flatMap((s, i) => (s.quotationAccessToken ? [`shopify-quotation-${i}`] : [])),
    "google-ads",
    "google-analytics",
    ...INBOXES.map((_, i) => `gmail-${i}`),
    "resend",
    "meta",
    "whatsapp",
    "wall",
  ];

  return NextResponse.json({
    service_checks: serviceChecks,
    env_vars: envChecks,
    data_freshness: freshness,
    email_freshness: emailFreshness,
    gmail_connections: gmailConnections,
    automations,
    automations_error: automationResult.ok ? null : automationResult.error,
    checked_at: new Date().toISOString(),
  });
}
