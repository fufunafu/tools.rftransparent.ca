"use client";

import { useState, useEffect, useCallback } from "react";

// The health page groups everything by system rather than by kind of check:
// one card per system (Email, Stores, Marketing…) holding its live probes,
// its env status, its data freshness, and its cron — so "is email OK?" is one
// glance, not three sections. Groups with problems sort to the top, and the
// banner names each issue with the fix instead of just counting them.

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
  automations: AutomationHealthData | null;
  automations_error: string | null;
  checked_at: string;
}

const statusConfig = {
  ok: { dot: "bg-green-500", text: "text-green-700", label: "OK" },
  slow: { dot: "bg-yellow-500", text: "text-yellow-700", label: "Slow" },
  error: { dot: "bg-red-500", text: "text-red-700", label: "Error" },
  unconfigured: { dot: "bg-sand-300", text: "text-sand-500", label: "Not configured" },
  checking: { dot: "bg-sand-300 animate-pulse", text: "text-sand-400", label: "Checking..." },
};

// ─── Groups ──────────────────────────────────────────────────────────────────
// Service check ids and env-check names are assigned to a system; anything
// unrecognized (a future check) falls through to Platform rather than
// disappearing.

type GroupKey = "email" | "stores" | "marketing" | "phones" | "surveys" | "platform";

const GROUPS: { key: GroupKey; title: string; blurb: string }[] = [
  { key: "email", title: "Email", blurb: "Inbox syncing and outgoing mail" },
  { key: "stores", title: "Shopify Stores", blurb: "Store APIs and the quotes apps" },
  { key: "marketing", title: "Marketing", blurb: "Ads, analytics, and Meta lead forms" },
  { key: "phones", title: "Phones & Call Data", blurb: "Call scraping across both phone systems" },
  { key: "surveys", title: "Surveys & Messaging", blurb: "WhatsApp employee surveys" },
  { key: "platform", title: "Platform", blurb: "Database, storage, tokens, and secrets" },
];

function groupOfService(id: string): GroupKey {
  if (id.startsWith("gmail-") || id === "resend") return "email";
  if (id.startsWith("shopify-")) return "stores";
  if (id === "google-ads" || id === "google-analytics" || id === "meta") return "marketing";
  if (id === "scraper") return "phones";
  if (id === "twilio") return "surveys";
  return "platform";
}

function groupOfEnv(name: string): GroupKey {
  if (name === "Gmail Env" || name === "Resend Env") return "email";
  if (name === "Shopify Env") return "stores";
  if (name === "Google Ads Env" || name === "GA4 Env" || name === "Meta Env") return "marketing";
  if (name === "Scraper Env") return "phones";
  if (name === "Twilio Env" || name === "App URLs") return "surveys";
  return "platform";
}

// Shown while a probe is still in flight, before its result carries a name.
function pendingLabel(id: string): string {
  if (id.startsWith("gmail-")) return "Gmail inbox";
  if (id.startsWith("shopify-quotation-")) return "Shopify quotes app";
  if (id.startsWith("shopify-")) return "Shopify store";
  const names: Record<string, string> = {
    supabase: "Supabase",
    tables: "Core Tables",
    storage: "Supabase Storage",
    scraper: "Scraper (Render)",
    "google-ads": "Google Ads",
    "google-analytics": "Google Analytics",
    resend: "Resend",
    meta: "Meta Lead Forms",
    twilio: "Twilio WhatsApp",
    wall: "Wall Board Token",
  };
  return names[id] ?? id;
}

// What to actually do about a failure, for the failures we know the shape of.
function fixHint(c: CheckResult): string | null {
  if (c.name.startsWith("Gmail:") && c.detail?.includes("Token refresh failed"))
    return "Re-authorize this inbox and replace its GMAIL_REFRESH_TOKEN in Vercel.";
  if (c.name === "Resend" && (c.detail?.includes("401") || c.detail?.includes("verified")))
    return "Replace RESEND_API_KEY in Vercel — reminder emails and cron alerts depend on it.";
  if (c.name === "Twilio WhatsApp" && c.status === "unconfigured")
    return "Set the TWILIO_* vars in Vercel to actually send WhatsApp surveys.";
  if (c.name === "Scraper (Render)" && c.status === "slow")
    return "Cold start on Render's free tier — working, just waking up.";
  if (c.name === "Meta Lead Forms" && c.detail?.includes("token"))
    return "Replace META_PAGE_ACCESS_TOKEN in Vercel.";
  if (c.detail?.startsWith("Missing: ")) return `Set in Vercel: ${c.detail.slice(9)}`;
  return null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
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

function StalePill({ stale }: { stale: boolean }) {
  return stale ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-600">
      Stale
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-600">
      Fresh
    </span>
  );
}

export default function HealthCheckDashboard() {
  const [initData, setInitData] = useState<InitialData | null>(null);
  const [services, setServices] = useState<Map<string, CheckResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runChecks = useCallback(async () => {
    setLoading(true);
    setError("");
    setServices(new Map());

    try {
      // Step 1: env vars, freshness, jobs, and the list of live probes
      const res = await fetch("/api/health-check");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InitialData = await res.json();
      setInitData(data);

      // Step 2: mark every probe as in flight
      const initial = new Map<string, CheckResult>();
      for (const name of data.service_checks) {
        initial.set(name, { name: pendingLabel(name), status: "checking", latency_ms: 0 });
      }
      setServices(new Map(initial));

      // Step 3: fire each probe in parallel, painting results as they land
      const promises = data.service_checks.map(async (checkName) => {
        try {
          const checkRes = await fetch(`/api/health-check?check=${checkName}`);
          const result: CheckResult = await checkRes.json();
          setServices((prev) => new Map(prev).set(checkName, result));
        } catch {
          setServices((prev) =>
            new Map(prev).set(checkName, {
              name: pendingLabel(checkName),
              status: "error",
              latency_ms: 0,
              detail: "Request failed",
            })
          );
        }
      });

      await Promise.allSettled(promises);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run health check");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  const automations = initData?.automations ?? null;
  const serviceEntries = Array.from(services.entries());
  const completed = serviceEntries.filter(([, s]) => s.status !== "checking");
  const allDone = completed.length === serviceEntries.length && serviceEntries.length > 0;

  // "Slow" counts: a service limping at 50s is not operational. "Never run"
  // jobs don't — matching the home page, a job awaiting its first scheduled
  // firing isn't an incident.
  const serviceIssues = completed
    .map(([, s]) => s)
    .filter((s) => s.status === "error" || s.status === "slow" || s.status === "unconfigured");
  const envIssues = initData?.env_vars.filter((c) => c.status !== "ok") ?? [];
  const jobIssues =
    automations && !automations.tableMissing
      ? [
          ...automations.failing.map((j) => ({ label: `${j.label} (job)`, hint: "Last run failed — see Settings → Automations for the error." })),
          ...automations.silent.map((j) => ({ label: `${j.label} (job)`, hint: `Hasn't run since ${timeAgo(j.lastRun)} — the scheduler may not be firing it.` })),
        ]
      : [];
  const issueCount = serviceIssues.length + envIssues.length + jobIssues.length;

  // Groups with problems first; original order otherwise.
  const groupStatus = new Map<GroupKey, { errors: number; slow: number; checking: number }>();
  for (const g of GROUPS) groupStatus.set(g.key, { errors: 0, slow: 0, checking: 0 });
  for (const [id, s] of serviceEntries) {
    const st = groupStatus.get(groupOfService(id))!;
    if (s.status === "checking") st.checking++;
    else if (s.status === "error") st.errors++;
    else if (s.status === "slow" || s.status === "unconfigured") st.slow++;
  }
  for (const env of initData?.env_vars ?? []) {
    if (env.status !== "ok") groupStatus.get(groupOfEnv(env.name))!.errors++;
  }
  const orderedGroups = [...GROUPS].sort((a, b) => {
    const sa = groupStatus.get(a.key)!;
    const sb = groupStatus.get(b.key)!;
    return sb.errors + sb.slow - (sa.errors + sa.slow);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-sand-900">System Health</h2>
          {initData && (
            <p className="text-sm text-sand-400 mt-0.5">
              Last checked: {formatDate(initData.checked_at)}
            </p>
          )}
        </div>
        <button
          onClick={runChecks}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium bg-sand-900 text-sand-50 rounded-lg hover:bg-sand-800 disabled:opacity-50 transition-colors"
        >
          {loading ? "Checking..." : "Run Health Check"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Overall status + named issues */}
      {serviceEntries.length > 0 && (
        <div
          className={`rounded-xl border ${
            !allDone
              ? "bg-sand-50 border-sand-200"
              : issueCount === 0
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
          }`}
        >
          <div className="flex items-center gap-3 p-4">
            {!allDone ? (
              <>
                <span className="w-3 h-3 rounded-full bg-sand-400 animate-pulse" />
                <span className="text-sm font-medium text-sand-600">
                  Checking services... ({completed.length}/{serviceEntries.length})
                </span>
              </>
            ) : issueCount === 0 ? (
              <>
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-green-800">All systems operational</span>
              </>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-sm font-medium text-amber-800">
                  {issueCount} issue{issueCount !== 1 ? "s" : ""} — what to do about each:
                </span>
              </>
            )}
          </div>
          {allDone && issueCount > 0 && (
            <ul className="px-4 pb-4 space-y-1.5">
              {[...serviceIssues, ...envIssues].map((c) => (
                <li key={c.name} className="flex gap-2 text-[13px] leading-snug">
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      c.status === "error" ? "bg-red-500" : "bg-yellow-500"
                    }`}
                  />
                  <span>
                    <span className="font-medium text-sand-800">{c.name}</span>
                    <span className="text-sand-600"> — {c.detail ?? statusConfig[c.status].label}</span>
                    {fixHint(c) && <span className="text-sand-500"> {fixHint(c)}</span>}
                  </span>
                </li>
              ))}
              {jobIssues.map((j) => (
                <li key={j.label} className="flex gap-2 text-[13px] leading-snug">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 bg-red-500" />
                  <span>
                    <span className="font-medium text-sand-800">{j.label}</span>
                    <span className="text-sand-500"> — {j.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* System groups */}
      {initData &&
        orderedGroups.map((group) => {
          const groupServices = serviceEntries.filter(([id]) => groupOfService(id) === group.key);
          const groupEnv = initData.env_vars.filter((e) => groupOfEnv(e.name) === group.key);
          const st = groupStatus.get(group.key)!;
          if (groupServices.length === 0 && groupEnv.length === 0) return null;

          return (
            <div key={group.key} className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
              {/* Group header */}
              <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-sand-500">
                    {group.title}
                  </p>
                  <p className="text-[11px] text-sand-400 mt-0.5">{group.blurb}</p>
                </div>
                {st.checking > 0 ? (
                  <span className="text-xs font-medium text-sand-400">Checking...</span>
                ) : st.errors > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {st.errors} problem{st.errors !== 1 ? "s" : ""}
                  </span>
                ) : st.slow > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-50 text-yellow-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                    Attention
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    All OK
                  </span>
                )}
              </div>

              {/* Probe rows */}
              <div className="divide-y divide-sand-50">
                {groupServices.map(([id, check]) => {
                  const cfg = statusConfig[check.status];
                  return (
                    <div
                      key={id}
                      className={`px-4 py-2.5 flex items-center gap-3 ${
                        check.status === "error" ? "bg-red-50/50" : ""
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                      <span className="text-sm font-medium text-sand-900 shrink-0">{check.name}</span>
                      {check.detail && (
                        <span
                          className={`text-xs truncate ${
                            check.status === "error" ? "text-red-600" : "text-sand-500"
                          }`}
                          title={check.detail}
                        >
                          {check.detail}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-3 shrink-0">
                        {check.latency_ms > 0 && (
                          <span className="text-[11px] text-sand-400">{check.latency_ms}ms</span>
                        )}
                        <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Email: per-inbox sync freshness */}
              {group.key === "email" && initData.email_freshness?.length > 0 && (
                <div className="border-t border-sand-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Inbox</th>
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Last Sync</th>
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {initData.email_freshness.map((row) => (
                        <tr key={row.inbox} className="border-t border-sand-50">
                          <td className="px-4 py-2">
                            <span className="font-medium text-sand-700">{row.label}</span>
                            <span className="ml-2 text-[11px] text-sand-400">{row.inbox}</span>
                          </td>
                          <td className="px-4 py-2 text-sand-600">
                            {row.last_sync ? (
                              <span title={formatDate(row.last_sync)}>{timeAgo(row.last_sync)}</span>
                            ) : (
                              <span className="text-sand-300">Never</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <StalePill stale={row.stale} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Phones: call freshness per store × source */}
              {group.key === "phones" && initData.data_freshness?.length > 0 && (
                <div className="border-t border-sand-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Store</th>
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Source</th>
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Latest Call</th>
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Last Scrape</th>
                        <th className="px-4 py-2 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {initData.data_freshness.map((row) => (
                        <tr key={`${row.store_id}-${row.source}`} className="border-t border-sand-50">
                          <td className="px-4 py-2 font-medium text-sand-700">{storeLabel(row.store_id)}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                row.source === "grasshopper"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {row.source === "grasshopper" ? "Grasshopper" : "CIK"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-sand-600">
                            {row.latest_call ? (
                              <span title={formatDate(row.latest_call)}>{timeAgo(row.latest_call)}</span>
                            ) : (
                              <span className="text-sand-300">No data</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sand-600">
                            {row.last_scrape ? (
                              <span title={formatDate(row.last_scrape)}>
                                {timeAgo(row.last_scrape)}
                                {row.scrape_status && row.scrape_status !== "success" && (
                                  <span className="ml-1.5 text-red-600 font-medium">· {row.scrape_status}</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-sand-300">Never</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <StalePill stale={row.stale} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Env summary line */}
              {groupEnv.length > 0 && (
                <div className="px-4 py-2 border-t border-sand-100 bg-sand-50/50 flex flex-wrap gap-x-4 gap-y-1">
                  {groupEnv.map((env) => (
                    <span key={env.name} className="text-[11px] text-sand-500">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                          statusConfig[env.status].dot
                        }`}
                      />
                      {env.name}:{" "}
                      <span className={env.status === "ok" ? "" : "text-red-600 font-medium"}>
                        {env.status === "ok" ? env.detail ?? "OK" : env.detail}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      {/* Scheduled jobs */}
      {automations && !automations.tableMissing && (
        <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-sand-500">
                Scheduled Jobs
              </p>
              <p className="text-[11px] text-sand-400 mt-0.5">
                Manage and run jobs on Settings → Automations
                {automations.lastRunAt && ` · most recent run ${timeAgo(automations.lastRunAt)}`}
              </p>
            </div>
            {automations.failing.length + automations.silent.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {automations.failing.length + automations.silent.length} problem
                {automations.failing.length + automations.silent.length !== 1 ? "s" : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {automations.total - automations.neverRun.length} of {automations.total} healthy
              </span>
            )}
          </div>
          <div className="p-4 flex flex-wrap items-center gap-2">
            {automations.failing.map((job) => (
              <span
                key={job.slug}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"
              >
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {job.label} — last run failed
              </span>
            ))}
            {automations.silent.map((job) => (
              <span
                key={job.slug}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                title={`Last run ${formatDate(job.lastRun)}`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                {job.label} — silent since {timeAgo(job.lastRun)}
              </span>
            ))}
            {automations.neverRun.map((job) => (
              <span
                key={job.slug}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sand-50 text-sand-500 border border-sand-200"
              >
                <span className="w-2 h-2 rounded-full bg-sand-300" />
                {job.label} — never run
              </span>
            ))}
            {automations.failing.length + automations.silent.length + automations.neverRun.length ===
              0 && <span className="text-sm text-sand-500">Every job ran on schedule.</span>}
          </div>
        </div>
      )}
      {initData?.automations_error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-4 text-sm">
          Scheduled jobs unavailable: {initData.automations_error}
        </div>
      )}
    </div>
  );
}
