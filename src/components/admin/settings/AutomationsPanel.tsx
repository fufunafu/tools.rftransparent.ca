"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AutomationJob } from "@/lib/automations";
import { getAutomationHealth, type AutomationHealth } from "@/lib/automation-status";
import type { CronRun } from "@/lib/cron-monitor";

const HEALTH_STYLES: Record<AutomationHealth, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-red-200 bg-red-50 text-red-700",
  stale: "border-amber-200 bg-amber-50 text-amber-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-500",
};

const RUN_STATUS_STYLES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700",
  error: "bg-red-50 text-red-700",
  skipped: "bg-slate-100 text-slate-600",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  success: "Completed",
  error: "Failed",
  skipped: "No work needed",
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function exactTime(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(value: number | null): string {
  if (value == null) return "Time not recorded";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} sec`;
}

function RunStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.skipped
      }`}
    >
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function healthLabel(health: AutomationHealth, latest: CronRun | undefined): string {
  if (health === "error") return "Needs attention";
  if (health === "stale") return "Overdue";
  if (health === "unknown") return "No run recorded";
  return latest?.status === "skipped" ? "No work needed" : "Healthy";
}

function HealthBadge({ health, latest }: { health: AutomationHealth; latest: CronRun | undefined }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${HEALTH_STYLES[health]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          health === "healthy"
            ? "bg-emerald-500"
            : health === "error"
              ? "bg-red-500"
              : health === "stale"
                ? "bg-amber-500"
                : "bg-slate-400"
        }`}
      />
      {healthLabel(health, latest)}
    </span>
  );
}

function JobIcon({ kind }: { kind: AutomationJob["kind"] }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        kind === "sync" ? "bg-blue-50 text-blue-600" : "bg-violet-50 text-violet-600"
      }`}
    >
      {kind === "sync" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.02 9.35h4.49V4.86m-.94 3.55A8.25 8.25 0 0 0 5.24 5.86M7.98 14.65H3.49v4.49m.94-3.55a8.25 8.25 0 0 0 14.33 2.55" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h12a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 18 19.5H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 7.5 6.1 4.06a2.5 2.5 0 0 0 2.8 0L19.5 7.5" />
        </svg>
      )}
    </span>
  );
}

function InfoItem({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</dt>
        <dd className="mt-0.5 text-xs font-medium leading-4 text-slate-700">{value}</dd>
        {detail && <p className="text-[10px] leading-4 text-slate-400">{detail}</p>}
      </div>
    </div>
  );
}

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 9h16.5M5.25 4.5h13.5A1.5 1.5 0 0 1 20.25 6v12.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V6a1.5 1.5 0 0 1 1.5-1.5Z" />
    </svg>
  );
}

function ResultIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m5.25 2.25a8.25 8.25 0 1 1-16.5 0 8.25 8.25 0 0 1 16.5 0Z" />
    </svg>
  );
}

function JobCard({
  job,
  runs,
  canRun,
  running,
  confirming,
  expanded,
  tableMissing,
  onRun,
  onConfirm,
  onCancelConfirm,
  onToggleHistory,
}: {
  job: AutomationJob;
  runs: CronRun[];
  canRun: boolean;
  running: string | null;
  confirming: string | null;
  expanded: string | null;
  tableMissing: boolean;
  onRun: (job: AutomationJob) => void;
  onConfirm: (job: AutomationJob) => void;
  onCancelConfirm: () => void;
  onToggleHistory: (slug: string) => void;
}) {
  const latest = runs[0];
  const health = getAutomationHealth(latest, job.staleAfterHours);
  const isExpanded = expanded === job.slug;
  const isConfirming = confirming === job.slug;
  const recentFailures = runs.filter((run) => run.status === "error").length;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <JobIcon kind={job.kind} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{job.label}</h3>
              <HealthBadge health={health} latest={latest} />
            </div>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{job.description}</p>
          </div>
        </div>

        <dl className="mt-3 grid gap-3 border-y border-slate-100 py-3 sm:grid-cols-2">
          <InfoItem
            icon={<ScheduleIcon />}
            label="Schedule"
            value={job.schedule}
            detail={job.scheduleDetail}
          />
          <InfoItem
            icon={<ResultIcon />}
            label={job.kind === "email" ? "Destination" : "Stored in RF Tools"}
            value={job.result}
          />
        </dl>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Last activity</p>
            {latest ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-700" title={exactTime(latest.started_at)}>
                  {timeAgo(latest.started_at)}
                </span>
                <span className="text-[11px] text-slate-400">{formatDuration(latest.duration_ms)}</span>
                {latest.triggered_by && (
                  <span className="text-[11px] text-slate-400">Run by {latest.triggered_by}</span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                {tableMissing ? "History tracking is not set up." : "No run has been recorded yet."}
              </p>
            )}
          </div>

          {canRun && (
            <button
              type="button"
              onClick={() => onRun(job)}
              disabled={running !== null}
              className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                job.kind === "email"
                  ? "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                  : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {running === job.slug ? "Running…" : job.kind === "email" ? "Send now" : "Run sync"}
            </button>
          )}
        </div>

        {latest?.status === "error" && latest.detail && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-red-500">Latest error</p>
            <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-red-700">
              {latest.detail}
            </pre>
          </div>
        )}

        {isConfirming && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-900">Send this automation now?</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              This is not a test. It will send real messages to <strong>{job.sendsEmail}</strong>.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onConfirm(job)}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Yes, send now
              </button>
              <button
                type="button"
                onClick={onCancelConfirm}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {runs.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onToggleHistory(job.slug)}
            aria-expanded={isExpanded}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-xs font-semibold text-slate-600">
              {isExpanded ? "Hide run history" : `View run history (${runs.length})`}
            </span>
            <span className={`text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>
          {!isExpanded && recentFailures > 0 && latest?.status !== "error" && (
            <p className="mt-1 text-[11px] text-slate-400">
              {recentFailures} older failure{recentFailures === 1 ? "" : "s"} in this history
            </p>
          )}
        </div>
      )}

      {isExpanded && runs.length > 0 && (
        <div className="divide-y divide-slate-100 border-t border-slate-100 px-4">
          {runs.map((run) => (
            <div key={run.started_at} className="grid gap-2 py-3 text-xs sm:grid-cols-[minmax(140px,1fr)_auto_auto] sm:items-center">
              <div>
                <p className="font-medium text-slate-700">{exactTime(run.started_at)}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400" title={run.detail ?? ""}>
                  {run.triggered_by ? `Run by ${run.triggered_by}` : "Scheduled run"}
                </p>
              </div>
              <RunStatus status={run.status} />
              <span className="text-right text-[11px] text-slate-400">{formatDuration(run.duration_ms)}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function AutomationGroup({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 sm:flex sm:items-baseline sm:gap-3">
        <div className="flex shrink-0 items-baseline gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-600">{eyebrow}</p>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500 sm:mt-0">{description}</p>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function DataSourcesSummary() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="grid gap-3 text-xs sm:grid-cols-3 sm:divide-x sm:divide-slate-100">
        <div className="sm:pr-3">
          <p className="font-semibold text-slate-800">Scheduled imports</p>
          <p className="mt-0.5 leading-4 text-slate-500">Calls, Gmail activity, and open quotes are saved in RF Tools.</p>
        </div>
        <div className="sm:px-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-slate-800">Google Ads</p>
            <Link href="/marketing" className="font-semibold text-blue-600 hover:text-blue-700">Open</Link>
          </div>
          <p className="mt-0.5 leading-4 text-slate-500">Read live when opened or refreshed, with a 30-minute browser cache.</p>
        </div>
        <div className="sm:pl-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-slate-800">Shopify dashboard</p>
            <Link href="/shopify" className="font-semibold text-blue-600 hover:text-blue-700">Open</Link>
          </div>
          <p className="mt-0.5 leading-4 text-slate-500">Read live when opened or refreshed. Charts use a 15-minute cache.</p>
        </div>
      </div>
      <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-4 text-slate-400">
        Follow Up CRM stores open Shopify quotes as leads. The Shopify dashboard only displays store data.
      </p>
    </section>
  );
}

export default function AutomationsPanel({
  jobs,
  history,
  tableMissing,
  canRun,
}: {
  jobs: AutomationJob[];
  history: Record<string, CronRun[]>;
  tableMissing: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranJob, setRanJob] = useState<string | null>(null);

  const syncJobs = jobs.filter((job) => job.kind === "sync");
  const emailJobs = jobs.filter((job) => job.kind === "email");
  const healthByJob = Object.fromEntries(
    jobs.map((job) => [
      job.slug,
      getAutomationHealth(history[job.slug]?.[0], job.staleAfterHours),
    ]),
  ) as Record<string, AutomationHealth>;
  const healthyCount = jobs.filter((job) => healthByJob[job.slug] === "healthy").length;
  const attentionCount = jobs.filter((job) => ["error", "stale"].includes(healthByJob[job.slug])).length;
  const unknownCount = jobs.filter((job) => healthByJob[job.slug] === "unknown").length;
  const latestActivity = Object.values(history)
    .flat()
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];

  async function runNow(job: AutomationJob) {
    setRunning(job.slug);
    setConfirming(null);
    setError(null);
    setRanJob(null);
    try {
      const res = await fetch("/api/settings/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: job.slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The automation could not run.");
      setRanJob(job.label);
      router.refresh();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The automation could not run.");
    } finally {
      setRunning(null);
    }
  }

  function handleRunClick(job: AutomationJob) {
    if (job.sendsEmail) {
      setConfirming(job.slug);
      setError(null);
      setRanJob(null);
      return;
    }
    void runNow(job);
  }

  function renderJob(job: AutomationJob) {
    return (
      <JobCard
        key={job.slug}
        job={job}
        runs={history[job.slug] ?? []}
        canRun={canRun}
        running={running}
        confirming={confirming}
        expanded={expanded}
        tableMissing={tableMissing}
        onRun={handleRunClick}
        onConfirm={(selectedJob) => void runNow(selectedJob)}
        onCancelConfirm={() => setConfirming(null)}
        onToggleHistory={(slug) => setExpanded((current) => (current === slug ? null : slug))}
      />
    );
  }

  const summaryTitle = tableMissing
    ? "Run tracking needs setup"
    : attentionCount > 0
      ? `${attentionCount} automation${attentionCount === 1 ? " needs" : "s need"} attention`
      : unknownCount > 0
        ? "Waiting for the first recorded runs"
        : "All automations are healthy";

  const summaryDescription = tableMissing
    ? "The jobs can still run, but this page cannot show their outcomes yet."
    : attentionCount > 0
      ? "Open the highlighted automation to see its latest error or missed schedule."
      : "Scheduled jobs are running within their expected windows.";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Automations</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-500">
            Data imports, live sources, and scheduled email in one place.
          </p>
        </div>
        <Link
          href="/settings/notifications"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          Manage email recipients
        </Link>
      </div>

      <DataSourcesSummary />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                attentionCount > 0
                  ? "bg-amber-50 text-amber-600"
                  : tableMissing || unknownCount > 0
                    ? "bg-slate-100 text-slate-500"
                    : "bg-emerald-50 text-emerald-600"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4.5 w-4.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m5.25 2.25a8.25 8.25 0 1 1-16.5 0 8.25 8.25 0 0 1 16.5 0Z" />
              </svg>
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{summaryTitle}</h2>
              <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-slate-500">{summaryDescription}</p>
            </div>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-slate-100 lg:min-w-[330px]">
            <div className="pr-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Healthy</dt>
              <dd className="mt-0.5 text-base font-semibold text-slate-900">{healthyCount}</dd>
            </div>
            <div className="px-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Attention</dt>
              <dd className={`mt-0.5 text-base font-semibold ${attentionCount > 0 ? "text-amber-600" : "text-slate-900"}`}>
                {attentionCount}
              </dd>
            </div>
            <div className="pl-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Last activity</dt>
              <dd className="mt-0.5 text-xs font-semibold leading-5 text-slate-700">
                {latestActivity ? timeAgo(latestActivity.started_at) : "Not recorded"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {tableMissing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Apply <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">061_cron_runs.sql</code> in Supabase to record run history. Scheduled jobs continue to run without it.
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {ranJob && !error && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {ranJob} finished successfully.
        </div>
      )}

      {!canRun && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          You have view-only access. An admin can run an automation manually.
        </div>
      )}

      <AutomationGroup
        eyebrow="Automatic imports"
        title="Stored on a schedule"
        description="Manual runs import data without sending email."
      >
        {syncJobs.map(renderJob)}
      </AutomationGroup>

      <AutomationGroup
        eyebrow="Email deliveries"
        title="Send scheduled messages"
        description="Manual sends require confirmation."
      >
        {emailJobs.map(renderJob)}
      </AutomationGroup>
    </div>
  );
}
