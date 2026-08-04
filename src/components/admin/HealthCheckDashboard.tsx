"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

interface CheckResult {
  name: string;
  status: "ok" | "error" | "slow" | "unconfigured" | "checking";
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

interface GmailConnectionData {
  id: string;
  inbox: string;
  label: string;
  connected: boolean;
  source: "database" | "environment" | null;
}

interface AutomationHealthData {
  tableMissing: boolean;
  failing: { slug: string; label: string }[];
  silent: { slug: string; label: string; lastRun: string }[];
  neverRun: { slug: string; label: string }[];
  lastRunAt: string | null;
  total: number;
}

interface InitialData {
  service_checks: string[];
  env_vars: CheckResult[];
  data_freshness: FreshnessRow[];
  email_freshness: EmailFreshnessRow[];
  gmail_connections: GmailConnectionData[];
  automations: AutomationHealthData | null;
  automations_error: string | null;
  checked_at: string;
}

type GroupKey = "email" | "stores" | "marketing" | "phones" | "surveys" | "platform";

const STATUS = {
  ok: {
    label: "Operational",
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
  },
  slow: {
    label: "Slow",
    dot: "bg-amber-500",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    text: "text-amber-700",
  },
  error: {
    label: "Error",
    dot: "bg-rose-500",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    text: "text-rose-700",
  },
  unconfigured: {
    label: "Not configured",
    dot: "bg-slate-400",
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    text: "text-slate-600",
  },
  checking: {
    label: "Checking",
    dot: "animate-pulse bg-blue-500",
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    text: "text-blue-700",
  },
} as const;

const GROUPS: Array<{ key: GroupKey; title: string; blurb: string }> = [
  { key: "platform", title: "Core platform", blurb: "Database, storage, tokens, and application configuration" },
  { key: "stores", title: "Shopify stores", blurb: "Store APIs and quotation applications" },
  { key: "email", title: "Email", blurb: "Inbox synchronization and outgoing mail" },
  { key: "phones", title: "Phones and call data", blurb: "Call collection across both phone systems" },
  { key: "marketing", title: "Marketing", blurb: "Advertising, analytics, and Meta lead forms" },
  { key: "surveys", title: "Surveys and messaging", blurb: "WhatsApp surveys and public application URLs" },
];

function groupOfService(id: string): GroupKey {
  if (id.startsWith("gmail-") || id === "resend") return "email";
  if (id.startsWith("shopify-")) return "stores";
  if (id === "google-ads" || id === "google-analytics" || id === "meta") return "marketing";
  if (id === "scraper") return "phones";
  if (id === "whatsapp") return "surveys";
  return "platform";
}

function groupOfEnv(name: string): GroupKey {
  if (name === "Gmail Env" || name === "Resend Env") return "email";
  if (name === "Shopify Env") return "stores";
  if (name === "Google Ads Env" || name === "GA4 Env" || name === "Meta Env") return "marketing";
  if (name === "Scraper Env") return "phones";
  if (name === "WhatsApp Env" || name === "App URLs") return "surveys";
  return "platform";
}

function pendingLabel(id: string): string {
  if (id.startsWith("gmail-")) return "Gmail inbox";
  if (id.startsWith("shopify-quotation-")) return "Shopify quotes app";
  if (id.startsWith("shopify-")) return "Shopify store";
  const names: Record<string, string> = {
    supabase: "Supabase",
    tables: "Core tables",
    storage: "Supabase storage",
    scraper: "Scraper",
    "google-ads": "Google Ads",
    "google-analytics": "Google Analytics",
    resend: "Resend",
    meta: "Meta lead forms",
    whatsapp: "WhatsApp Cloud API",
    wall: "Wall board token",
  };
  return names[id] ?? id;
}

function fixHint(check: CheckResult): string | null {
  if (
    check.name.startsWith("Gmail:")
    && check.detail?.toLowerCase().includes("token refresh failed")
  ) {
    return "Use Reconnect beside this inbox and approve Gmail access again.";
  }
  if (check.name === "Resend" && (check.detail?.includes("401") || check.detail?.includes("verified"))) {
    return "Replace RESEND_API_KEY in Vercel. Reminder emails and cron alerts depend on it.";
  }
  if (check.name === "WhatsApp Cloud API" && check.status === "unconfigured") {
    return "Set the WhatsApp Cloud API variables in Vercel to enable surveys.";
  }
  if (check.name === "Scraper (Render)" && check.status === "slow") {
    return "The Render service is responding, but its cold start is taking longer than expected.";
  }
  if (check.name === "Meta Lead Forms" && check.detail?.toLowerCase().includes("token")) {
    return "Replace META_PAGE_ACCESS_TOKEN in Vercel.";
  }
  if (check.detail?.startsWith("Missing: ")) return `Set these values in Vercel: ${check.detail.slice(9)}`;
  return null;
}

function timeAgo(iso: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function storeLabel(id: string): string {
  if (id === "bc_transparent") return "BC Transparent";
  if (id === "rf_transparent") return "RF Transparent";
  return id;
}

function StatusBadge({ status }: { status: CheckResult["status"] }) {
  const config = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${config.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function GroupStatusBadge({
  summary,
}: {
  summary: { errors: number; attention: number; checking: number };
}) {
  if (summary.checking > 0) return <StatusBadge status="checking" />;
  if (summary.errors > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        {summary.errors} problem{summary.errors === 1 ? "" : "s"}
      </span>
    );
  }
  if (summary.attention > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Needs review
      </span>
    );
  }
  return <StatusBadge status="ok" />;
}

function FreshnessBadge({ stale }: { stale: boolean }) {
  return stale ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Needs sync
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Fresh
    </span>
  );
}

function GroupIcon({ group }: { group: GroupKey }) {
  const paths: Record<GroupKey, ReactNode> = {
    platform: (
      <>
        <rect x="4" y="4" width="16" height="6" rx="2" />
        <rect x="4" y="14" width="16" height="6" rx="2" />
        <path d="M8 7h.01M8 17h.01" />
      </>
    ),
    stores: (
      <>
        <path d="M4 9.5 6 4h12l2 5.5" />
        <path d="M5 10v9h14v-9M9 19v-5h6v5" />
        <path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
      </>
    ),
    email: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="m4.5 7 6.1 4.2a2.5 2.5 0 0 0 2.8 0L19.5 7" />
      </>
    ),
    phones: (
      <path d="M7.2 3.5 10 8l-2 2a15 15 0 0 0 6 6l2-2 4.5 2.8-.8 3a2 2 0 0 1-2 1.5C9.5 20.5 3.5 14.5 2.7 6.3a2 2 0 0 1 1.5-2l3-.8Z" />
    ),
    marketing: (
      <>
        <path d="M4 13h3l9 5V6l-9 5H4v2Z" />
        <path d="M7 13v5M19 9a4 4 0 0 1 0 6" />
      </>
    ),
    surveys: (
      <>
        <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1Z" />
        <path d="M7 9h10M7 13h6" />
      </>
    ),
  };
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
        {paths[group]}
      </svg>
    </span>
  );
}

function MetricStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "attention" }) {
  const valueClass = tone === "good" ? "text-emerald-600" : tone === "attention" ? "text-amber-600" : "text-slate-950";
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm font-semibold tracking-tight ${valueClass}`}>{value}</dd>
    </div>
  );
}

function ServiceRow({
  check,
  actionHref,
  actionLabel,
}: {
  check: CheckResult;
  actionHref?: string;
  actionLabel?: string;
}) {
  const config = STATUS[check.status];
  return (
    <div className={`flex items-start gap-2 px-3 py-2 ${check.status === "error" ? "bg-rose-50/50" : ""}`}>
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${config.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs font-semibold text-slate-800">{check.name}</p>
          {check.latency_ms > 0 && <span className="text-[10px] tabular-nums text-slate-400">{check.latency_ms} ms</span>}
        </div>
        {check.detail && (
          <p className={`mt-0.5 text-[10px] leading-4 ${check.status === "error" ? "break-words text-rose-600" : "break-words text-slate-500 sm:truncate"}`} title={check.detail}>
            {check.detail}
          </p>
        )}
      </div>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-blue-200 bg-blue-50 px-2 text-[10px] font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
        >
          {actionLabel}
        </Link>
      )}
      <StatusBadge status={check.status} />
    </div>
  );
}

function EnvironmentRows({ checks }: { checks: CheckResult[] }) {
  if (checks.length === 0) return null;
  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2">
      <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Configuration</p>
      <div className="space-y-1">
        {checks.map((check) => (
          <div key={check.name} className="flex items-start gap-2 text-[10px]">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS[check.status].dot}`} />
            <span className="font-medium text-slate-600">{check.name}</span>
            <span className={`ml-auto max-w-[65%] text-right leading-4 ${check.status === "ok" ? "text-slate-400" : "font-medium text-rose-600"}`}>
              {check.detail ?? STATUS[check.status].label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HealthCheckDashboard({
  canManageGmail,
  gmailNotice,
}: {
  canManageGmail: boolean;
  gmailNotice: { status: "success" | "warning" | "error"; message: string } | null;
}) {
  const [initData, setInitData] = useState<InitialData | null>(null);
  const [services, setServices] = useState<Map<string, CheckResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runChecks = useCallback(async () => {
    setLoading(true);
    setError("");
    setServices(new Map());

    try {
      const response = await fetch("/api/health-check");
      if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
      const data: InitialData = await response.json();
      setInitData(data);

      const pending = new Map<string, CheckResult>();
      for (const id of data.service_checks) {
        pending.set(id, { name: pendingLabel(id), status: "checking", latency_ms: 0 });
      }
      setServices(new Map(pending));

      await Promise.allSettled(
        data.service_checks.map(async (id) => {
          try {
            const checkResponse = await fetch(`/api/health-check?check=${id}`);
            if (!checkResponse.ok) throw new Error(`HTTP ${checkResponse.status}`);
            const result: CheckResult = await checkResponse.json();
            setServices((current) => new Map(current).set(id, result));
          } catch {
            setServices((current) =>
              new Map(current).set(id, {
                name: pendingLabel(id),
                status: "error",
                latency_ms: 0,
                detail: "The probe request failed.",
              }),
            );
          }
        }),
      );
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The health check could not run.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const automations = initData?.automations ?? null;
  const serviceEntries = Array.from(services.entries());
  const completed = serviceEntries.filter(([, check]) => check.status !== "checking");
  const healthyServices = completed.filter(([, check]) => check.status === "ok").length;
  const allDone = serviceEntries.length > 0 && completed.length === serviceEntries.length;
  const serviceIssues = completed.map(([, check]) => check).filter((check) => check.status !== "ok");
  const envIssues = initData?.env_vars.filter((check) => check.status !== "ok") ?? [];
  const failingJobs = automations && !automations.tableMissing ? automations.failing : [];
  const silentJobs = automations && !automations.tableMissing ? automations.silent : [];
  const issueCount = serviceIssues.length + envIssues.length + failingJobs.length + silentJobs.length;
  const staleDataCount = [
    ...(initData?.email_freshness ?? []).map((row) => row.stale),
    ...(initData?.data_freshness ?? []).map((row) => row.stale),
  ].filter(Boolean).length;
  const latencies = completed.map(([, check]) => check.latency_ms).filter((value) => value > 0);
  const averageLatency = latencies.length > 0 ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0;

  const groupSummary = new Map<GroupKey, { errors: number; attention: number; checking: number }>();
  for (const group of GROUPS) groupSummary.set(group.key, { errors: 0, attention: 0, checking: 0 });
  for (const [id, check] of serviceEntries) {
    const summary = groupSummary.get(groupOfService(id))!;
    if (check.status === "checking") summary.checking += 1;
    else if (check.status === "error") summary.errors += 1;
    else if (check.status !== "ok") summary.attention += 1;
  }
  for (const check of initData?.env_vars ?? []) {
    if (check.status === "error") groupSummary.get(groupOfEnv(check.name))!.errors += 1;
    else if (check.status !== "ok") groupSummary.get(groupOfEnv(check.name))!.attention += 1;
  }

  const orderedGroups = [...GROUPS].sort((left, right) => {
    const leftSummary = groupSummary.get(left.key)!;
    const rightSummary = groupSummary.get(right.key)!;
    return rightSummary.errors * 2 + rightSummary.attention - (leftSummary.errors * 2 + leftSummary.attention);
  });

  const overallTitle = !initData
    ? "Preparing system checks"
    : !allDone
      ? "Checking every connection"
      : issueCount === 0
        ? "All systems operational"
        : `${issueCount} item${issueCount === 1 ? " needs" : "s need"} attention`;
  const overallDetail = !initData
    ? "Loading configuration, data freshness, and scheduled-job history."
    : !allDone
      ? `${completed.length} of ${serviceEntries.length} live probes have responded.`
      : issueCount === 0
        ? "Services, configuration, data feeds, and scheduled jobs are responding normally."
        : "Review the action list below, then rerun the check after making changes.";
  const overallTone = !initData || !allDone ? "checking" : issueCount === 0 ? "healthy" : "attention";

  return (
    <div className="space-y-4 pb-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Operations</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-950">System health</h1>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500">
            Connections, data freshness, configuration, and scheduled jobs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runChecks()}
          disabled={loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7v5h-5M4 17v-5h5M6.1 8.2A7 7 0 0 1 18.7 7M5.3 17A7 7 0 0 0 17.9 15.8" />
          </svg>
          {loading ? "Running checks" : "Run health check"}
        </button>
      </header>

      <section
        aria-live="polite"
        className={`rounded-xl border bg-white p-4 shadow-sm ${
          overallTone === "healthy"
            ? "border-emerald-200"
            : overallTone === "attention"
              ? "border-amber-200"
              : "border-blue-200"
        }`}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] lg:items-center">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                overallTone === "healthy"
                  ? "bg-emerald-50 text-emerald-600"
                  : overallTone === "attention"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-blue-50 text-blue-600"
              }`}
            >
              {overallTone === "checking" ? (
                <span className="h-4 w-4 animate-pulse rounded-full bg-current" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
                  {overallTone === "healthy" ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4 4L19 7" />
                  ) : (
                    <><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5" /><path strokeLinecap="round" d="M12 17h.01" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.3 4.9 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0Z" /></>
                  )}
                </svg>
              )}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">{overallTitle}</h2>
              <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-slate-500">{overallDetail}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                {initData && <span>Started {formatDate(initData.checked_at)}</span>}
                {serviceEntries.length > 0 && !allDone && <span>{completed.length}/{serviceEntries.length} probes complete</span>}
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <MetricStat
              label="Live"
              value={serviceEntries.length > 0 ? `${healthyServices}/${serviceEntries.length}` : "..."}
              tone={allDone && healthyServices === serviceEntries.length ? "good" : "neutral"}
            />
            <MetricStat
              label="Review"
              value={initData ? String(issueCount) : "..."}
              tone={issueCount > 0 ? "attention" : initData ? "good" : "neutral"}
            />
            <MetricStat
              label="Data"
              value={initData ? (staleDataCount === 0 ? "Fresh" : `${staleDataCount} stale`) : "..."}
              tone={staleDataCount > 0 ? "attention" : initData ? "good" : "neutral"}
            />
            <MetricStat
              label="Response"
              value={averageLatency > 0 ? `${averageLatency} ms` : "..."}
              tone={averageLatency > 3_000 ? "attention" : averageLatency > 0 ? "good" : "neutral"}
            />
          </dl>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <p className="font-semibold">The health check could not finish</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {gmailNotice && (
        <div
          role={gmailNotice.status === "error" ? "alert" : "status"}
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            gmailNotice.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : gmailNotice.status === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {gmailNotice.message}
        </div>
      )}

      {allDone && issueCount > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
          <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 11.5 11 13.5 15.5 9M4 5h16v14H4z" />
              </svg>
            </span>
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Action list</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-amber-800">Resolve these findings, then run the check again.</p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {[...serviceIssues, ...envIssues].map((check, index) => (
              <div key={`${check.name}-${index}`} className="flex gap-2 px-4 py-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${check.status === "error" ? "bg-rose-500" : "bg-amber-500"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{check.name}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{check.detail ?? STATUS[check.status].label}</p>
                  {fixHint(check) && <p className="mt-0.5 text-[11px] font-medium leading-4 text-blue-700">{fixHint(check)}</p>}
                </div>
              </div>
            ))}
            {failingJobs.map((job) => (
              <div key={job.slug} className="flex gap-2 px-4 py-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                <div>
                  <p className="text-xs font-semibold text-slate-800">{job.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Latest run failed. Open Automations for the error.</p>
                </div>
              </div>
            ))}
            {silentJobs.map((job) => (
              <div key={job.slug} className="flex gap-2 px-4 py-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <div>
                  <p className="text-xs font-semibold text-slate-800">{job.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">No run since {timeAgo(job.lastRun)}. The scheduler may not be firing.</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {initData && (
        <section>
          <div className="mb-2 flex items-baseline gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-600">System map</p>
            <h2 className="text-sm font-semibold text-slate-950">Connections and data feeds</h2>
          </div>
          <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {orderedGroups.map((group) => {
              const groupServices = serviceEntries.filter(([id]) => groupOfService(id) === group.key);
              const groupEnv = initData.env_vars.filter((check) => groupOfEnv(check.name) === group.key);
              if (groupServices.length === 0 && groupEnv.length === 0) return null;
              const summary = groupSummary.get(group.key)!;

              return (
                <article key={group.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-start gap-2 border-b border-slate-100 p-3">
                    <GroupIcon group={group.key} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
                        <GroupStatusBadge summary={summary} />
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{group.blurb}</p>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {groupServices.map(([id, check]) => {
                      const gmailConnection = initData.gmail_connections.find(
                        (connection) => connection.id === id,
                      );
                      return (
                        <ServiceRow
                          key={id}
                          check={check}
                          actionHref={
                            canManageGmail && gmailConnection
                              ? `/api/oauth/gmail?inbox=${encodeURIComponent(gmailConnection.inbox)}`
                              : undefined
                          }
                          actionLabel={
                            gmailConnection
                              ? gmailConnection.connected
                                ? "Reconnect"
                                : "Connect"
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>

                  {group.key === "email" && initData.email_freshness.length > 0 && (
                    <div className="border-t border-slate-100 px-3 py-2">
                      <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Inbox freshness</p>
                      <div className="divide-y divide-slate-100">
                        {initData.email_freshness.map((row) => (
                          <div key={row.inbox} className="flex items-center gap-2 py-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-semibold text-slate-700" title={row.inbox}>{row.label}</p>
                            </div>
                            <p className="text-[10px] font-medium text-slate-500" title={formatDate(row.last_sync)}>{row.last_sync ? timeAgo(row.last_sync) : "Never"}</p>
                            <FreshnessBadge stale={row.stale} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {group.key === "phones" && initData.data_freshness.length > 0 && (
                    <div className="border-t border-slate-100 px-3 py-2">
                      <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">Call data freshness</p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {initData.data_freshness.map((row) => (
                          <div key={`${row.store_id}-${row.source}`} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-[10px] font-semibold text-slate-700">{storeLabel(row.store_id)}</p>
                                <p className="text-[9px] text-slate-400">{row.source === "grasshopper" ? "Grasshopper" : "CIK"}</p>
                              </div>
                              <FreshnessBadge stale={row.stale} />
                            </div>
                            <dl className="mt-1.5 grid grid-cols-2 gap-1 text-[9px]">
                              <div>
                                <dt className="text-slate-400">Latest call</dt>
                                <dd className="font-medium text-slate-600" title={formatDate(row.latest_call)}>{row.latest_call ? timeAgo(row.latest_call) : "No data"}</dd>
                              </div>
                              <div>
                                <dt className="text-slate-400">Last scrape</dt>
                                <dd className={`font-medium ${row.scrape_status && row.scrape_status !== "success" ? "text-rose-600" : "text-slate-600"}`} title={formatDate(row.last_scrape)}>
                                  {row.last_scrape ? timeAgo(row.last_scrape) : "Never"}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <EnvironmentRows checks={groupEnv} />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {automations && !automations.tableMissing && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-baseline gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-600">Scheduled work</p>
                <h2 className="text-sm font-semibold text-slate-900">Automation health</h2>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {automations.lastRunAt ? `Most recent activity ${timeAgo(automations.lastRunAt)}` : "No activity has been recorded yet."}
              </p>
            </div>
            <Link href="/settings/automations" className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900">
              Open automations
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5 p-3">
            {automations.failing.map((job) => (
              <span key={job.slug} className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">
                <span className="h-2 w-2 rounded-full bg-rose-500" />{job.label}: failed
              </span>
            ))}
            {automations.silent.map((job) => (
              <span key={job.slug} className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700" title={formatDate(job.lastRun)}>
                <span className="h-2 w-2 rounded-full bg-amber-500" />{job.label}: overdue
              </span>
            ))}
            {automations.neverRun.map((job) => (
              <span key={job.slug} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full bg-slate-400" />{job.label}: no run recorded
              </span>
            ))}
            {automations.failing.length + automations.silent.length + automations.neverRun.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />Every scheduled job is running within its expected window.
              </div>
            )}
          </div>
        </section>
      )}

      {initData?.automations_error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Automation history is unavailable: {initData.automations_error}
        </div>
      )}
    </div>
  );
}
