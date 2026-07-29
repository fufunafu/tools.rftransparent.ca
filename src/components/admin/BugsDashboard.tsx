"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  type BugReport,
  type BugSystem,
  type BugComment,
  type BugAttachment,
  BUG_TYPES,
  BUG_STATUSES,
  bugTypeLabel,
  bugTypeColor,
  bugStatusLabel,
  isOpenStatus,
  getBugMetrics,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_TYPES,
} from "@/lib/bug-reports";

type StatusFilter = "all" | "open_only" | BugReport["status"];

interface FormState {
  system_id: string;
  title: string;
  type: string;
  description: string;
  steps: string;
}

function emptyForm(systemId: string): FormState {
  return { system_id: systemId, title: "", type: "other", description: "", steps: "" };
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "anne@cloture-verre.com" -> "anne" — full addresses crowd a thread. */
function shortName(email: string): string {
  return email.split("@")[0];
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-red-50 text-red-600",
  in_progress: "bg-amber-50 text-amber-700",
  repaired: "bg-emerald-50 text-emerald-700",
  wont_fix: "bg-slate-100 text-slate-500",
};

export default function BugsDashboard({
  isAdmin,
  currentUser,
}: {
  isAdmin: boolean;
  currentUser: string;
}) {
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [systems, setSystems] = useState<BugSystem[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [systemFilter, setSystemFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(""));
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [newSystem, setNewSystem] = useState("");
  const [addingSystem, setAddingSystem] = useState(false);
  const [saving, setSaving] = useState(false);

  const [openBug, setOpenBug] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bugs", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load bug reports");
        return;
      }
      const json = await res.json();
      setBugs(json.bugs ?? []);
      setSystems(json.systems ?? []);
      setTableMissing(Boolean(json.tableMissing));
    } catch {
      setError("Could not load bug reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const systemName = useCallback(
    (id: string) => systems.find((s) => s.id === id)?.name ?? "Unknown system",
    [systems]
  );

  const filtered = useMemo(
    () =>
      bugs.filter((b) => {
        if (systemFilter !== "all" && b.system_id !== systemFilter) return false;
        if (statusFilter === "all") return true;
        if (statusFilter === "open_only") return isOpenStatus(b.status);
        return b.status === statusFilter;
      }),
    [bugs, systemFilter, statusFilter]
  );

  const metrics = useMemo(() => getBugMetrics(bugs), [bugs]);
  const systemBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bug of bugs) {
      counts.set(bug.system_id, (counts.get(bug.system_id) ?? 0) + 1);
    }
    return Array.from(counts, ([id, count]) => ({
      id,
      name: systems.find((system) => system.id === id)?.name ?? "Unknown system",
      count,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [bugs, systems]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const openNewForm = () => {
    setForm(emptyForm(systems[0]?.id ?? ""));
    setPendingFiles([]);
    setNewSystem("");
    setError(null);
    setShowForm(true);
  };

  const addSystem = async () => {
    const name = newSystem.trim();
    if (!name) return;
    setAddingSystem(true);
    try {
      const res = await fetch("/api/bugs/systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not add that system");
        return;
      }
      setSystems((prev) =>
        prev.some((s) => s.id === json.system.id)
          ? prev
          : [...prev, json.system].sort((a, b) => a.name.localeCompare(b.name))
      );
      setForm((f) => ({ ...f, system_id: json.system.id }));
      setNewSystem("");
    } finally {
      setAddingSystem(false);
    }
  };

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const next: File[] = [];
    for (const file of Array.from(incoming)) {
      if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
        setError(`${file.name} isn't a PNG, JPEG, GIF or WebP.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`${file.name} is over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB.`);
        continue;
      }
      next.push(file);
    }
    if (next.length) setPendingFiles((prev) => [...prev, ...next]);
  };

  const submit = async () => {
    if (!form.title.trim()) {
      setError("Give it a one-line summary so it's findable later.");
      return;
    }
    if (!form.system_id) {
      setError("Pick which system this is in.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save that");
        return;
      }

      // Screenshots upload after the report exists, so each one can be filed
      // under its bug id and nothing is left orphaned if the save fails.
      const uploaded: BugAttachment[] = [];
      for (const file of pendingFiles) {
        const body = new FormData();
        body.append("bug_id", json.bug.id);
        body.append("file", file);
        const up = await fetch("/api/bugs/attachments", { method: "POST", body });
        const upJson = await up.json();
        if (up.ok) uploaded.push(upJson.attachment);
        else setError(upJson.error ?? `Could not upload ${file.name}`);
      }

      setBugs((prev) => [{ ...json.bug, attachments: uploaded }, ...prev]);
      setShowForm(false);
      setPendingFiles([]);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (bug: BugReport, status: BugReport["status"]) => {
    const res = await fetch("/api/bugs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bug.id, status }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not update the status");
      return;
    }
    setBugs((prev) =>
      prev.map((b) => (b.id === bug.id ? { ...b, ...json.bug, attachments: b.attachments } : b))
    );
  };

  const removeBug = async (bug: BugReport) => {
    const res = await fetch(`/api/bugs?id=${bug.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete that report");
      return;
    }
    setBugs((prev) => prev.filter((b) => b.id !== bug.id));
    setOpenBug(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return <p className="text-sm text-slate-500">Loading bug reports…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Bug Reports</h2>
          <p className="text-sm text-slate-500 mt-1">
            Track, prioritize, and close issues across our internal systems.
          </p>
        </div>
        <button
          onClick={openNewForm}
          disabled={tableMissing}
          className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Report a bug
        </button>
      </div>

      {tableMissing && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
          Bug reports aren&apos;t set up yet — apply migration{" "}
          <code className="font-mono text-[13px]">063_bug_reports.sql</code> in the Supabase SQL
          editor, then reload this page.
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700 flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            Dismiss
          </button>
        </div>
      )}

      {!tableMissing && (
        <>
          {bugs.length > 0 && <BugSummary metrics={metrics} />}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">Reports</h3>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Showing {filtered.length} of {metrics.total}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    aria-label="Filter by status"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 bg-slate-50"
                  >
                    <option value="all">All statuses</option>
                    <option value="open_only">Still open</option>
                    {BUG_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={systemFilter}
                    onChange={(e) => setSystemFilter(e.target.value)}
                    aria-label="Filter by system"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 bg-slate-50"
                  >
                    <option value="all">Every system</option>
                    {systems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="p-8 rounded-xl border border-slate-200 bg-white text-center">
                  <p className="text-sm text-slate-500">
                    {bugs.length === 0
                      ? "No bugs reported yet. That, or nobody's told us."
                      : "Nothing matches those filters."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((bug) => (
                    <BugRow
                      key={bug.id}
                      bug={bug}
                      systemName={systemName(bug.system_id)}
                      expanded={openBug === bug.id}
                      onToggle={() => setOpenBug(openBug === bug.id ? null : bug.id)}
                      isAdmin={isAdmin}
                      currentUser={currentUser}
                      onStatus={(s) => setStatus(bug, s)}
                      onDelete={() => removeBug(bug)}
                    />
                  ))}
                </div>
              )}
            </div>

            {bugs.length > 0 && (
              <BugInsights metrics={metrics} systemBreakdown={systemBreakdown} />
            )}
          </div>
        </>
      )}

      {/* Report form */}
      {showForm && (
        <ReportModal
          form={form}
          setForm={setForm}
          systems={systems}
          newSystem={newSystem}
          setNewSystem={setNewSystem}
          addSystem={addSystem}
          addingSystem={addingSystem}
          pendingFiles={pendingFiles}
          addFiles={addFiles}
          removeFile={(i) => setPendingFiles((prev) => prev.filter((_, n) => n !== i))}
          saving={saving}
          onCancel={() => setShowForm(false)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

function formatRepairTime(days: number | null): string {
  if (days === null) return "Not yet";
  if (days < 1) return "<1 day";
  const rounded = days >= 10 ? Math.round(days).toString() : days.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${rounded === "1" ? "day" : "days"}`;
}

function BugSummary({ metrics }: { metrics: ReturnType<typeof getBugMetrics> }) {
  const cards = [
    {
      label: "Total reports",
      value: metrics.total,
      detail: "All time",
      dot: "bg-blue-500",
    },
    {
      label: "Needs attention",
      value: metrics.needsAttention,
      detail: `${metrics.statusCounts.open} open · ${metrics.statusCounts.in_progress} being fixed`,
      dot: "bg-red-500",
    },
    {
      label: "Last 7 days",
      value: metrics.reportedLastSevenDays,
      detail: "New reports",
      dot: "bg-violet-500",
    },
    {
      label: "Average repair time",
      value: formatRepairTime(metrics.averageRepairDays),
      detail:
        metrics.statusCounts.repaired > 0
          ? `Across ${metrics.statusCounts.repaired} repaired report${
              metrics.statusCounts.repaired === 1 ? "" : "s"
            }`
          : "No repaired reports yet",
      dot: "bg-emerald-500",
    },
  ];

  return (
    <section aria-labelledby="bug-summary-heading">
      <h3 id="bug-summary-heading" className="sr-only">
        Bug report summary
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${card.dot}`} aria-hidden="true" />
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {card.label}
              </p>
            </div>
            <p className="mt-1 text-xl font-semibold text-slate-900">{card.value}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{card.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BugInsights({
  metrics,
  systemBreakdown,
}: {
  metrics: ReturnType<typeof getBugMetrics>;
  systemBreakdown: Array<{ id: string; name: string; count: number }>;
}) {
  const statusSegments = [
    {
      value: "open",
      label: "Open",
      count: metrics.statusCounts.open,
      color: "bg-red-400",
    },
    {
      value: "in_progress",
      label: "Being fixed",
      count: metrics.statusCounts.in_progress,
      color: "bg-amber-400",
    },
    {
      value: "repaired",
      label: "Repaired",
      count: metrics.statusCounts.repaired,
      color: "bg-emerald-400",
    },
    {
      value: "wont_fix",
      label: "Won't fix",
      count: metrics.statusCounts.wont_fix,
      color: "bg-slate-400",
    },
  ];
  const largestSystemCount = systemBreakdown[0]?.count ?? 1;

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4 xl:sticky xl:top-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-slate-900">Insights</h3>
        <span className="text-xs text-slate-400">{metrics.total} reports</span>
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          By status
        </p>
        <div
          className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100"
          aria-label={statusSegments
            .map((segment) => `${segment.label}: ${segment.count}`)
            .join(", ")}
        >
          {statusSegments
            .filter((segment) => segment.count > 0)
            .map((segment) => (
              <span
                key={segment.value}
                className={`${segment.color} first:rounded-l-full last:rounded-r-full`}
                style={{ width: `${(segment.count / metrics.total) * 100}%` }}
              />
            ))}
        </div>
        <div className="mt-3 space-y-2">
          {statusSegments.map((segment) => (
            <div
              key={segment.value}
              className="flex items-center justify-between gap-3 text-xs text-slate-500"
            >
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${segment.color}`} aria-hidden="true" />
                {segment.label}
              </span>
              <span className="font-medium tabular-nums text-slate-700">{segment.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          By system
        </p>
        <div className="mt-3 space-y-3">
          {systemBreakdown.slice(0, 5).map((system) => (
            <div key={system.id}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-slate-600">{system.name}</span>
                <span className="font-medium tabular-nums text-slate-700">{system.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-400"
                  style={{ width: `${(system.count / largestSystemCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ─── One report ──────────────────────────────────────────────────────────────

function BugRow({
  bug,
  systemName,
  expanded,
  onToggle,
  isAdmin,
  currentUser,
  onStatus,
  onDelete,
}: {
  bug: BugReport;
  systemName: string;
  expanded: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  currentUser: string;
  onStatus: (s: BugReport["status"]) => void;
  onDelete: () => void;
}) {
  const [comments, setComments] = useState<BugComment[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [loadedComments, setLoadedComments] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!expanded || loadedComments) return;
    (async () => {
      const res = await fetch(`/api/bugs/comments?bug_id=${bug.id}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setComments(json.comments ?? []);
      }
      setLoadedComments(true);
    })();
  }, [expanded, loadedComments, bug.id]);

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch("/api/bugs/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bug_id: bug.id, body }),
      });
      if (res.ok) {
        const json = await res.json();
        setComments((prev) => [...prev, json.comment]);
        setDraft("");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
      >
        <span
          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: bugTypeColor(bug.type) }}
          title={bugTypeLabel(bug.type)}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{bug.title}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {systemName} · {bugTypeLabel(bug.type)} ·{" "}
            {bug.reported_by ? shortName(bug.reported_by) : "unknown"} · {relativeDay(bug.created_at)}
            {bug.attachments && bug.attachments.length > 0 && ` · ${bug.attachments.length} image`}
            {bug.comment_count ? ` · ${bug.comment_count} comment${bug.comment_count === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
            STATUS_STYLE[bug.status] ?? "bg-slate-100 text-slate-500"
          }`}
        >
          {bugStatusLabel(bug.status)}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-4">
          {bug.description && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                What happened
              </p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{bug.description}</p>
            </div>
          )}
          {bug.steps && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                How to reproduce it
              </p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{bug.steps}</p>
            </div>
          )}

          {bug.attachments && bug.attachments.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                Screenshots
              </p>
              <div className="flex flex-wrap gap-2">
                {bug.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/bugs/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {/* Served through our own auth-checked route, so a plain
                        <img> is right — next/image would try to optimize a
                        private, session-gated URL. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/bugs/attachments/${a.id}`}
                      alt={a.filename ?? "screenshot"}
                      className="h-28 w-auto rounded-lg border border-slate-200 object-cover hover:border-blue-300 transition-colors"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Status controls */}
          {isAdmin ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Status
              </span>
              {BUG_STATUSES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => onStatus(s.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    bug.status === s.value
                      ? "bg-blue-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              An admin marks bugs repaired — add a comment if you have more detail.
            </p>
          )}

          {/* Thread */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
              Comments
            </p>
            {comments.length > 0 && (
              <div className="space-y-3 mb-3">
                {comments.map((c) => (
                  <div key={c.id} className="text-sm">
                    <p className="text-xs text-slate-400">
                      <span className="font-medium text-slate-600">
                        {c.author === currentUser ? "You" : shortName(c.author)}
                      </span>{" "}
                      · {timestamp(c.created_at)}
                    </p>
                    <p className="text-slate-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-start gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={isAdmin ? "What was wrong, or what fixed it…" : "Add anything that helps…"}
                rows={2}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button
                onClick={post}
                disabled={posting || !draft.trim()}
                className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {posting ? "…" : "Post"}
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="pt-2 border-t border-slate-100">
              {confirmDelete ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">Delete this report and its screenshots?</span>
                  <button onClick={onDelete} className="text-red-600 font-medium hover:underline">
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-slate-400 hover:text-red-600 transition-colors"
                >
                  Delete report
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Report form ─────────────────────────────────────────────────────────────

function ReportModal({
  form,
  setForm,
  systems,
  newSystem,
  setNewSystem,
  addSystem,
  addingSystem,
  pendingFiles,
  addFiles,
  removeFile,
  saving,
  onCancel,
  onSubmit,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  systems: BugSystem[];
  newSystem: string;
  setNewSystem: (v: string) => void;
  addSystem: () => void;
  addingSystem: boolean;
  pendingFiles: File[];
  addFiles: (files: FileList | File[] | null) => void;
  removeFile: (index: number) => void;
  saving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const [showAddSystem, setShowAddSystem] = useState(systems.length === 0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Escape closes, matching the other dialogs in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Report a bug"
    >
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">Report a bug</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            The more specific, the faster it gets fixed.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Which system
            </label>
            <div className="flex gap-2">
              <select
                value={form.system_id}
                onChange={(e) => setForm((f) => ({ ...f, system_id: e.target.value }))}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
              >
                {systems.length === 0 && <option value="">No systems yet — add one</option>}
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAddSystem((v) => !v)}
                className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              >
                + New
              </button>
            </div>
            {showAddSystem && (
              <div className="flex gap-2 mt-2">
                <input
                  value={newSystem}
                  onChange={(e) => setNewSystem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSystem();
                    }
                  }}
                  placeholder="Name of the system"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
                <button
                  type="button"
                  onClick={addSystem}
                  disabled={addingSystem || !newSystem.trim()}
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              One-line summary
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Saving a quote clears the customer name"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              What kind of problem
            </label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              {BUG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              What happened
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="What you expected, and what you got instead."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              How to make it happen again <span className="text-slate-300">(optional)</span>
            </label>
            <textarea
              value={form.steps}
              onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))}
              rows={2}
              placeholder="1. Open a quote  2. Change the price  3. Save"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Screenshots <span className="text-slate-300">(optional)</span>
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              onPaste={(e) => addFiles(Array.from(e.clipboardData.files))}
              onClick={() => fileInput.current?.click()}
              className="px-3 py-4 rounded-lg border border-dashed border-slate-300 text-center text-sm text-slate-400 cursor-pointer hover:border-blue-300 hover:text-slate-500 transition-colors"
            >
              Drop an image, paste from the clipboard, or click to pick
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {pendingFiles.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 text-xs text-slate-600"
                  >
                    {f.name}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
          >
            {saving ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
