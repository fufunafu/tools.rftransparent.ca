"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AutomationJob } from "@/lib/automations";
import type { CronRun } from "@/lib/cron-monitor";

const STATUS_STYLES: Record<string, string> = {
  success: "bg-green-50 text-green-700 border-green-200",
  error: "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-sand-100 text-sand-500 border-sand-200",
};

const STATUS_LABELS: Record<string, string> = {
  success: "OK",
  error: "Failed",
  skipped: "Nothing to do",
};

// "3 hours ago" beats a timestamp when the question is "is this job stuck?".
function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.skipped
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function AutomationsPanel({
  jobs,
  initialRuns,
  tableMissing,
  canRun,
}: {
  jobs: AutomationJob[];
  initialRuns: Record<string, CronRun>;
  tableMissing: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranJob, setRanJob] = useState<string | null>(null);

  async function runNow(job: AutomationJob) {
    setRunning(job.slug);
    setError(null);
    setRanJob(null);
    try {
      const res = await fetch("/api/settings/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: job.slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Run failed");
      setRanJob(job.label);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-sand-900">Automations</h2>
        <p className="text-sm text-sand-500 mt-1">
          Jobs that run on their own in the background. If the numbers on a page look stale, this
          is where to check why.
        </p>
      </div>

      {tableMissing && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
          Run history isn&apos;t being recorded yet — apply migration{" "}
          <code className="text-xs bg-amber-100 px-1 py-0.5 rounded">061_cron_runs.sql</code> in the
          Supabase SQL editor. The jobs themselves run fine either way; you just won&apos;t see a
          history until then.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {ranJob && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
          {ranJob} finished.
        </div>
      )}

      <div className="space-y-3">
        {jobs.map((job) => {
          const run = initialRuns[job.slug];
          return (
            <div key={job.slug} className="bg-white rounded-xl border border-sand-200/60 p-5">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-sand-900">{job.label}</h3>
                    {run ? <StatusPill status={run.status} /> : null}
                  </div>
                  <p className="text-xs text-sand-500 mt-1">{job.description}</p>
                  <p className="text-xs text-sand-400 mt-2">{job.schedule}</p>
                </div>

                {canRun && (
                  <button
                    type="button"
                    onClick={() => runNow(job)}
                    disabled={running !== null}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-sand-200 text-sand-700 hover:bg-sand-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {running === job.slug ? "Running…" : "Run now"}
                  </button>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-sand-100 text-xs">
                {run ? (
                  <div className="space-y-1">
                    <div className="text-sand-600">
                      Last ran {timeAgo(run.started_at)}
                      {run.duration_ms != null && ` · took ${(run.duration_ms / 1000).toFixed(1)}s`}
                      {run.triggered_by && ` · started by ${run.triggered_by}`}
                    </div>
                    {run.status === "error" && run.detail && (
                      <pre className="text-[11px] text-red-600 bg-red-50 rounded p-2 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                        {run.detail}
                      </pre>
                    )}
                  </div>
                ) : (
                  <span className="text-sand-400">
                    {tableMissing ? "History not available yet." : "Hasn't run since tracking started."}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!canRun && (
        <p className="text-xs text-sand-400">
          Only admins can trigger a job by hand.
        </p>
      )}
    </div>
  );
}
