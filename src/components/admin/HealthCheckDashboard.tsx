"use client";

import { useState, useEffect, useCallback } from "react";

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
  ok: { dot: "bg-green-500", bg: "bg-green-50", border: "border-green-200", text: "text-green-700", label: "OK" },
  slow: { dot: "bg-yellow-500", bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700", label: "Slow" },
  error: { dot: "bg-red-500", bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "Error" },
  unconfigured: { dot: "bg-sand-300", bg: "bg-sand-50", border: "border-sand-200", text: "text-sand-500", label: "Not configured" },
  checking: { dot: "bg-sand-300 animate-pulse", bg: "bg-sand-50", border: "border-sand-200", text: "text-sand-400", label: "Checking..." },
};

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
      // Step 1: Get env vars, freshness, and list of service checks
      const res = await fetch("/api/health-check");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: InitialData = await res.json();
      setInitData(data);

      // Step 2: Set all services to "checking" state
      const initial = new Map<string, CheckResult>();
      for (const name of data.service_checks) {
        initial.set(name, { name, status: "checking", latency_ms: 0 });
      }
      setServices(new Map(initial));

      // Step 3: Fire each service check in parallel, update as each completes
      const promises = data.service_checks.map(async (checkName) => {
        try {
          const checkRes = await fetch(`/api/health-check?check=${checkName}`);
          const result: CheckResult = await checkRes.json();
          setServices((prev) => {
            const next = new Map(prev);
            next.set(checkName, result);
            return next;
          });
        } catch {
          setServices((prev) => {
            const next = new Map(prev);
            next.set(checkName, { name: checkName, status: "error", latency_ms: 0, detail: "Request failed" });
            return next;
          });
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

  const serviceList = Array.from(services.values());
  const completedServices = serviceList.filter((s) => s.status !== "checking");
  const automations = initData?.automations ?? null;
  // "Slow" counts: a service limping at 50s is not operational. "Never run"
  // jobs don't — matching the home page, a job that hasn't had its first
  // scheduled firing yet isn't an incident.
  const issues = [
    ...completedServices.filter((c) => c.status === "error" || c.status === "slow"),
    ...(initData?.env_vars.filter((c) => c.status !== "ok") ?? []),
    ...(automations && !automations.tableMissing
      ? [...automations.failing, ...automations.silent]
      : []),
  ];
  const allDone = completedServices.length === serviceList.length && serviceList.length > 0;

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

      {/* Overall status */}
      {serviceList.length > 0 && (
        <div className={`rounded-xl border p-4 ${
          !allDone
            ? "bg-sand-50 border-sand-200"
            : issues.length === 0
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
        }`}>
          <div className="flex items-center gap-3">
            {!allDone ? (
              <>
                <div className="w-3 h-3 rounded-full bg-sand-400 animate-pulse" />
                <span className="text-sm font-medium text-sand-600">
                  Checking services... ({completedServices.length}/{serviceList.length})
                </span>
              </>
            ) : issues.length === 0 ? (
              <>
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-green-800">All systems operational</span>
              </>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-sm font-medium text-amber-800">
                  {issues.length} issue{issues.length !== 1 ? "s" : ""} detected
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Services */}
      {serviceList.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
            Services
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {serviceList.map((check) => {
              const cfg = statusConfig[check.status];
              return (
                <div
                  key={check.name}
                  className={`rounded-xl border p-4 transition-all ${cfg.bg} ${cfg.border}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                      <span className="text-sm font-medium text-sand-900">{check.name}</span>
                    </div>
                    <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                  </div>
                  {check.latency_ms > 0 && (
                    <p className="text-xs text-sand-500">{check.latency_ms}ms</p>
                  )}
                  {check.detail && (
                    <p className="text-xs text-sand-500 mt-1 truncate" title={check.detail}>
                      {check.detail}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {initData && (
        <>
          {/* Scheduled Jobs */}
          {automations && !automations.tableMissing && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
                Scheduled Jobs
              </p>
              <div className="bg-white rounded-xl border border-sand-200/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
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
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    {automations.total -
                      automations.failing.length -
                      automations.silent.length -
                      automations.neverRun.length}{" "}
                    of {automations.total} healthy
                  </span>
                </div>
                <p className="text-[11px] text-sand-400 mt-2">
                  Manage and run jobs on Settings → Automations.
                  {automations.lastRunAt && ` Most recent run: ${timeAgo(automations.lastRunAt)}.`}
                </p>
              </div>
            </div>
          )}
          {initData.automations_error && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-4 text-sm">
              Scheduled jobs unavailable: {initData.automations_error}
            </div>
          )}

          {/* Data Freshness */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
              Data Freshness
            </p>
            <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 text-left">
                    <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Store</th>
                    <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Source</th>
                    <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Latest Call</th>
                    <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Last Scrape</th>
                    <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {initData.data_freshness.map((row) => (
                    <tr key={`${row.store_id}-${row.source}`} className="border-b border-sand-50">
                      <td className="px-4 py-2.5 font-medium text-sand-700">{storeLabel(row.store_id)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          row.source === "grasshopper" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {row.source === "grasshopper" ? "Grasshopper" : "CIK"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sand-600">
                        {row.latest_call ? (
                          <span title={formatDate(row.latest_call)}>{timeAgo(row.latest_call)}</span>
                        ) : (
                          <span className="text-sand-300">No data</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sand-600">
                        {row.last_scrape ? (
                          <span title={formatDate(row.last_scrape)}>
                            {timeAgo(row.last_scrape)}
                            {row.scrape_status && row.scrape_status !== "success" && (
                              <span className="ml-1.5 text-red-600 font-medium">
                                · {row.scrape_status}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-sand-300">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.stale ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-600">
                            Stale
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-600">
                            Fresh
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Email Sync Freshness */}
          {initData.email_freshness?.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
                Email Sync Freshness
              </p>
              <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-sand-100 text-left">
                      <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Inbox</th>
                      <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Last Sync</th>
                      <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initData.email_freshness.map((row) => (
                      <tr key={row.inbox} className="border-b border-sand-50 last:border-0">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-sand-700">{row.label}</span>
                          <span className="ml-2 text-[11px] text-sand-400">{row.inbox}</span>
                        </td>
                        <td className="px-4 py-2.5 text-sand-600">
                          {row.last_sync ? (
                            <span title={formatDate(row.last_sync)}>{timeAgo(row.last_sync)}</span>
                          ) : (
                            <span className="text-sand-300">Never</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.stale ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-600">
                              Stale
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-600">
                              Fresh
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Environment Variables */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
              Environment Variables
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {initData.env_vars.map((check) => {
                const cfg = statusConfig[check.status];
                return (
                  <div
                    key={check.name}
                    className={`rounded-xl border p-3 ${cfg.bg} ${cfg.border}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      <span className="text-xs font-medium text-sand-700">{check.name}</span>
                    </div>
                    {check.detail && (
                      <p className="text-[11px] text-sand-500 mt-1 truncate" title={check.detail}>
                        {check.detail}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
