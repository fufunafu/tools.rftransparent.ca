"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  CallStatus,
  Lead,
  LeadCallAttempt,
  LeadSource,
  LeadSubmission,
  Outcome,
} from "@/lib/customer-service/leads";
import {
  OUTCOME_LABELS,
  CALL_STATUS_LABELS,
  extractSubmissionDetails,
} from "@/lib/customer-service/leads";
import {
  buildCustomLeadTrend,
  buildLeadTrend,
  calculateLeadFunnel,
  calculateLeadFunnelBySource,
  type LeadFunnelMetricsBySource,
  type LeadTrendRange,
} from "@/lib/lead-analytics";
import { formatCADShort, formatCADWhole } from "@/lib/format";

const LeadTrendChart = dynamic(() => import("@/components/admin/LeadTrendChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-sand-50 rounded-md" />,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return "No calls yet";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min avg response`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 24) return `${hours} hr avg response`;
  return `${Math.round((hours / 24) * 10) / 10} day avg response`;
}

const SOURCE_BADGE: Record<LeadSource, { label: string; className: string }> = {
  website: { label: "Website", className: "bg-blue-100 text-blue-700" },
  meta: { label: "Meta", className: "bg-rose-100 text-rose-700" },
};

function leadSources(lead: Lead): LeadSource[] {
  return lead.sources?.length ? lead.sources : [lead.source];
}

function hasLeadSource(lead: Lead, source: LeadSource): boolean {
  return leadSources(lead).includes(source);
}

type TrendSelection = LeadTrendRange | "custom";

const TREND_RANGES: { value: TrendSelection; label: string; metricLabel: string }[] = [
  { value: "30d", label: "30 days", metricLabel: "30 days" },
  { value: "90d", label: "90 days", metricLabel: "90 days" },
  { value: "12m", label: "12 months", metricLabel: "12 months" },
  { value: "custom", label: "Custom", metricLabel: "custom" },
];

function defaultCustomDates(): { from: string; to: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const key = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const now = new Date();
  return { from: key(new Date(now.getTime() - 29 * 86_400_000)), to: key(now) };
}

const OUTCOME_BADGE: Record<Outcome, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  quoted: "bg-indigo-100 text-indigo-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-slate-100 text-slate-500",
};

const CALL_BADGE: Record<CallStatus, string> = {
  not_called: "bg-amber-50 text-amber-700 border border-amber-200",
  no_answer: "bg-gray-100 text-gray-600 border border-gray-200",
  called: "bg-green-50 text-green-700 border border-green-200",
};

const FILTER_TABS: { value: string; label: string; match: (l: Lead) => boolean }[] = [
  { value: "uncalled", label: "Uncalled", match: (l) => l.call_status === "not_called" },
  { value: "no_quote", label: "Awaiting Quote", match: (l) => l.call_status !== "not_called" && !l.quote_number && l.outcome !== "won" && l.outcome !== "lost" },
  { value: "open_quote", label: "Open Quote", match: (l) => !!l.quote_number && l.outcome === "quoted" },
  { value: "won", label: "Won", match: (l) => l.outcome === "won" },
  { value: "lost", label: "Lost", match: (l) => l.outcome === "lost" },
  { value: "all", label: "All", match: () => true },
];

interface MetaStatus {
  configured: boolean;
  connected: boolean;
  page_name: string | null;
  subscribed: boolean;
  error: string | null;
  can_sync: boolean;
}

interface MetaSyncSummary {
  forms: number;
  fetched: number;
  inserted: number;
  deduped: number;
  skipped: number;
  failed: number;
  errors: string[];
}

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

// ─── Lead detail panel ───────────────────────────────────────────────────────

function SubmissionCard({
  submission,
  position,
  total,
}: {
  submission: LeadSubmission;
  position: number;
  total: number;
}) {
  const details = extractSubmissionDetails(submission.raw_payload).filter((detail) => (
    detail.value !== submission.message
    && detail.value !== submission.email
    && detail.value !== submission.phone
    && detail.value !== submission.name
  ));

  return (
    <article className="rounded-xl border border-sand-200 bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-3 bg-sand-50/70 px-4 py-3 border-b border-sand-200">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sand-400">
              Submission {position} of {total}
            </p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${SOURCE_BADGE[submission.source].className}`}>
              {SOURCE_BADGE[submission.source].label}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-sand-800 truncate">
            {submission.source_detail || "Form submission"}
          </p>
        </div>
        <time className="text-xs text-sand-500 whitespace-nowrap" dateTime={submission.submitted_at}>
          {formatDateTime(submission.submitted_at)}
        </time>
      </div>

      <div className="p-4 space-y-3">
        {submission.message && (
          <div>
            <p className="text-[11px] font-medium text-sand-400 mb-1">Customer request</p>
            <p className="text-sm leading-6 text-sand-700 whitespace-pre-wrap">{submission.message}</p>
          </div>
        )}

        {details.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {details.map((detail) => (
              <div key={detail.key} className="rounded-lg border border-sand-200 px-3 py-2.5 min-w-0">
                <dt className="text-[11px] text-sand-400">{detail.label}</dt>
                <dd className="mt-0.5 text-sm font-medium text-sand-800 break-words">{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer text-sand-400 hover:text-sand-600">View raw submission</summary>
          <pre className="mt-2 p-3 rounded-lg bg-sand-50 border border-sand-200 overflow-x-auto text-[11px] text-sand-600">{JSON.stringify(submission.raw_payload, null, 2)}</pre>
        </details>
      </div>
    </article>
  );
}

function LeadDetailPanel({
  lead,
  onClose,
  onChanged,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const callAttemptLeadIds = lead.duplicate_ids?.length ? lead.duplicate_ids : [lead.id];
  const { data: attemptsData } = useSWR<{ attempts: LeadCallAttempt[] }>(
    `/api/customer-service/leads?view=call_attempts&lead_ids=${encodeURIComponent(callAttemptLeadIds.join(","))}`,
    fetcher
  );
  const attempts = attemptsData?.attempts ?? [];

  const [logging, setLogging] = useState(false);
  const [callResult, setCallResult] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [logError, setLogError] = useState<string | null>(null);

  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(lead.quote_number ?? "");
  const [quoteAmount, setQuoteAmount] = useState(lead.quote_amount?.toString() ?? "");
  const displayName = lead.name?.trim() || lead.email?.split("@")[0] || lead.phone || "Lead";
  const submissions = useMemo(
    () => {
      const values = lead.submissions?.length
        ? lead.submissions
        : [{
            id: lead.id,
            source: lead.source,
            source_detail: lead.source_detail,
            form_id: lead.form_id,
            page_url: lead.page_url,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            message: lead.message,
            raw_payload: lead.raw_payload,
            submitted_at: lead.submitted_at,
          }];
      return [...values].sort(
        (left, right) => new Date(right.submitted_at).getTime() - new Date(left.submitted_at).getTime(),
      );
    },
    [lead],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleLogCall = async () => {
    setLogging(true);
    setLogError(null);
    // Blank result is fine — default to "Called" so a one-click log works.
    const result = callResult.trim() || "Called";
    try {
      const res = await fetch("/api/customer-service/leads?action=log_call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, result, notes: callNotes.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLogError(body.error ?? `Failed to log call (${res.status})`);
        return;
      }
      setCallResult("");
      setCallNotes("");
      onChanged();
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLogging(false);
    }
  };

  const patchLead = async (update: Record<string, unknown>) => {
    await fetch("/api/customer-service/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, ...update }),
    });
    onChanged();
  };

  const handleSaveQuote = async () => {
    await patchLead({
      quote_number: quoteNumber.trim() || null,
      quote_amount: quoteAmount.trim() ? Number(quoteAmount) : null,
      quote_sent_at: quoteNumber.trim() ? new Date().toISOString() : null,
      outcome: quoteNumber.trim() && lead.outcome !== "won" && lead.outcome !== "lost" ? "quoted" : lead.outcome,
    });
    setEditingQuote(false);
  };

  return (
    <div className="fixed inset-0 bg-sand-950/40 flex justify-end z-50" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-detail-title"
        className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-5 border-b border-sand-200 sticky top-0 bg-white/95 backdrop-blur z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-sand-400">
                {leadSources(lead).map((source) => SOURCE_BADGE[source].label).join(" + ")} lead
              </p>
              <h2 id="lead-detail-title" className="mt-1 text-2xl font-semibold tracking-tight text-sand-900 truncate">
                {displayName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                  {OUTCOME_LABELS[lead.outcome]}
                </span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CALL_BADGE[lead.call_status]}`}>
                  {CALL_STATUS_LABELS[lead.call_status]}
                </span>
                {(lead.duplicate_count ?? 1) > 1 && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                    {lead.duplicate_count} submissions combined
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close lead details"
              className="text-sand-400 hover:text-sand-700 hover:bg-sand-100 rounded-full p-2 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 sm:px-6 py-4 border-b border-sand-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {lead.phone ? (
            <a
              href={`tel:${lead.phone}`}
              className="text-center px-4 py-2.5 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Call {lead.phone}
            </a>
          ) : (
            <div className="text-center px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm font-medium text-amber-800">
              No phone submitted
            </div>
          )}
          {lead.email ? (
            <a
              href={`mailto:${lead.email}`}
              className="text-center px-4 py-2.5 rounded-lg border border-sand-300 bg-white text-sm font-semibold text-sand-700 hover:bg-sand-50 transition-colors"
            >
              Email lead
            </a>
          ) : (
            <div className="text-center px-4 py-2.5 rounded-lg bg-sand-50 border border-sand-200 text-sm font-medium text-sand-400">
              No email submitted
            </div>
          )}
        </div>

        {/* Submissions */}
        <section className="px-5 sm:px-6 py-6 border-b border-sand-200 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Submissions</h3>
            <span className="text-xs text-sand-400">
              {submissions.length} {submissions.length === 1 ? "submission" : "submissions"}
            </span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-sand-200 bg-sand-50/60 p-4 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-sand-400">First submitted</dt>
              <dd className="mt-1 font-medium text-sand-800">{formatDateTime(lead.submitted_at)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-sand-400">Assigned to</dt>
              <dd className="mt-1 font-medium text-sand-800 truncate">{lead.assigned_to || "Unassigned"}</dd>
            </div>
            {lead.email && (
              <div className="min-w-0">
                <dt className="text-xs text-sand-400">Email</dt>
                <dd className="mt-1 truncate"><a href={`mailto:${lead.email}`} className="font-medium text-blue-600 hover:underline">{lead.email}</a></dd>
              </div>
            )}
            {lead.phone && (
              <div className="min-w-0">
                <dt className="text-xs text-sand-400">Phone</dt>
                <dd className="mt-1"><a href={`tel:${lead.phone}`} className="font-medium text-blue-600 hover:underline">{lead.phone}</a></dd>
              </div>
            )}
          </dl>
          <div className="space-y-3">
            {submissions.map((submission, index) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                position={index + 1}
                total={submissions.length}
              />
            ))}
          </div>
        </section>

        {/* Call log */}
        <section className="px-5 sm:px-6 py-6 border-b border-sand-200 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Call activity</h3>
            <span className="text-xs text-sand-400">{attempts.length} {attempts.length === 1 ? "call" : "calls"}</span>
          </div>
          {attempts.length === 0 ? (
            <div className={`rounded-xl border p-4 ${lead.phone ? "border-sand-200 bg-sand-50" : "border-amber-200 bg-amber-50"}`}>
              <p className={`text-sm font-medium ${lead.phone ? "text-sand-700" : "text-amber-900"}`}>No calls linked to this lead</p>
              <p className={`text-xs mt-1 leading-5 ${lead.phone ? "text-sand-500" : "text-amber-700"}`}>
                {lead.phone
                  ? "Automatic phone matching has not found a call after this submission."
                  : "This submission did not include a phone number, so automatic call matching cannot identify it."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {attempts.map((a) => (
                <div key={a.id} className="flex gap-3 rounded-xl border border-sand-200 p-3">
                  <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-xs font-semibold text-blue-700 shrink-0 uppercase">
                    {a.staff.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-sand-900 truncate">{a.staff}</span>
                      <span className="text-[11px] text-sand-400 whitespace-nowrap">{formatDateTime(a.called_at)}</span>
                    </div>
                    <p className="text-sm text-sand-600">{a.result}</p>
                    {a.notes && <p className="text-xs text-sand-500 mt-0.5">{a.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-sand-200 p-4 space-y-3">
            <p className="text-sm font-semibold text-sand-800">Log a call manually</p>
            <label className="block text-xs font-medium text-sand-500">
              Result
            <input
              type="text"
              value={callResult}
              onChange={(e) => setCallResult(e.target.value)}
                placeholder="For example, spoke and interested"
                className="mt-1.5 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            </label>
            <label className="block text-xs font-medium text-sand-500">
              Notes <span className="font-normal text-sand-400">(optional)</span>
              <textarea
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
                rows={2}
                placeholder="Add context for the next person"
                className="mt-1.5 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
            </label>
            <button
              type="button"
              onClick={handleLogCall}
              disabled={logging}
              className="w-full px-3 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {logging ? "Logging..." : "+ Log Call"}
            </button>
            {logError && (
              <p className="text-xs text-red-600">{logError}</p>
            )}
          </div>
        </section>

        {/* Quote */}
        <section className="px-5 sm:px-6 py-6 border-b border-sand-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Quote</h3>
            {!editingQuote && (
              <button onClick={() => setEditingQuote(true)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                {lead.quote_number ? "Edit" : "+ Link Quote"}
              </button>
            )}
          </div>
          {editingQuote ? (
            <div className="rounded-lg border border-sand-200 p-3 space-y-2">
              <input
                type="text"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                placeholder="Quote / draft order # (e.g. D-10421)"
                className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="number"
                value={quoteAmount}
                onChange={(e) => setQuoteAmount(e.target.value)}
                placeholder="Amount (CAD)"
                className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingQuote(false)} className="px-3 py-1.5 text-xs text-sand-600">Cancel</button>
                <button onClick={handleSaveQuote} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded">Save</button>
              </div>
            </div>
          ) : lead.quote_number ? (
            <div className="rounded-xl bg-sand-50 border border-sand-200 p-4 text-sm space-y-2">
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Quote #</span>
                <span className="font-medium text-sand-900">{lead.quote_number}</span>
              </div>
              {lead.quote_amount != null && (
                <div className="flex justify-between">
                  <span className="text-sand-500">Amount</span>
                  <span className="font-medium text-sand-900">{formatCADWhole(Number(lead.quote_amount))}</span>
                </div>
              )}
              {lead.quote_sent_at && (
                <div className="flex justify-between">
                  <span className="text-sand-500">Sent</span>
                  <span className="text-sand-700">{formatDateTime(lead.quote_sent_at)}</span>
                </div>
              )}
              {lead.assigned_to && (
                <div className="flex justify-between gap-3">
                  <span className="text-sand-500">Staff</span>
                  <span className="text-sand-700 text-right">{lead.assigned_to}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-sand-400">No quote sent yet.</p>
          )}
        </section>

        {/* Outcome */}
        <section className="px-5 sm:px-6 py-6 space-y-3">
          <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Outcome</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((o) => (
              <button
                key={o}
                onClick={() => patchLead({ outcome: o })}
                className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                  lead.outcome === o
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-sand-200 text-sand-600 hover:bg-sand-50"
                }`}
              >
                {OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
          {lead.outcome === "lost" && (
            <input
              type="text"
              defaultValue={lead.lost_reason ?? ""}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val !== (lead.lost_reason ?? "")) patchLead({ lost_reason: val || null });
              }}
              placeholder="Lost reason"
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          )}
          <textarea
            defaultValue={lead.notes ?? ""}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val !== (lead.notes ?? "")) patchLead({ notes: val || null });
            }}
            placeholder="Internal notes"
            rows={3}
            className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </section>
      </aside>
    </div>
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export default function LeadsDashboard() {
  const [filter, setFilter] = useState<string>("uncalled");
  const [sourceFilter, setSourceFilter] = useState<"all" | LeadSource>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [trendRange, setTrendRange] = useState<TrendSelection>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [chartSources, setChartSources] = useState({ website: true, meta: true });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [syncResult, setSyncResult] = useState<MetaSyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Background refresh: SWR pauses polling while the tab is hidden
  // (refreshWhenHidden defaults to false) and revalidateOnFocus catches up
  // when it becomes visible again — overriding the provider-wide opt-out.
  const autoRefreshOpts = {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    focusThrottleInterval: 30_000,
  };
  const { data, error: leadsError, isLoading } = useSWR<{ leads: Lead[] }>(
    "/api/customer-service/leads",
    fetcher,
    autoRefreshOpts
  );
  const {
    data: metaStatus,
    error: metaStatusError,
    mutate: refreshMetaStatus,
  } = useSWR<MetaStatus>("/api/customer-service/leads?view=meta_status", fetcher, autoRefreshOpts);
  const leads = useMemo(() => data?.leads ?? [], [data?.leads]);
  const { mutate } = useSWRConfig();

  const refresh = () => {
    mutate((key) => typeof key === "string" && key.startsWith("/api/customer-service/leads"));
  };

  const syncMeta = async () => {
    setSyncingMeta(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const response = await fetch("/api/customer-service/leads?action=sync_meta", {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? `Meta sync failed with status ${response.status}`);
      }
      setSyncResult(body.summary as MetaSyncSummary);
      refresh();
      await refreshMetaStatus();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Meta sync failed");
    } finally {
      setSyncingMeta(false);
    }
  };

  const sourceLeads = useMemo(
    () => sourceFilter === "all" ? leads : leads.filter((lead) => hasLeadSource(lead, sourceFilter)),
    [leads, sourceFilter],
  );

  const filtered = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.value === filter) ?? FILTER_TABS[FILTER_TABS.length - 1];
    return sourceLeads.filter((l) => {
      if (!tab.match(l)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const submissionValues = l.submissions?.flatMap((submission) => [
          submission.name,
          submission.email,
          submission.phone,
        ]) ?? [];
        if (
          !(l.name ?? "").toLowerCase().includes(q) &&
          !(l.email ?? "").toLowerCase().includes(q) &&
          !(l.phone ?? "").includes(q) &&
          !(l.assigned_to ?? "").toLowerCase().includes(q) &&
          !submissionValues.some((value) => (value ?? "").toLowerCase().includes(q))
        ) return false;
      }
      return true;
    }).sort((a, b) => {
      const difference = new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
      return sortOrder === "newest" ? difference : -difference;
    });
  }, [sourceLeads, filter, search, sortOrder]);

  const filterCounts: Record<string, number> = useMemo(() => {
    const result: Record<string, number> = {};
    for (const tab of FILTER_TABS) {
      result[tab.value] = sourceLeads.filter((l) => tab.match(l)).length;
    }
    return result;
  }, [sourceLeads]);

  const metrics = useMemo(() => {
    const funnel = calculateLeadFunnel(leads);
    const openLeads = leads.filter((l) => l.outcome !== "won" && l.outcome !== "lost");
    const uncalledLeads = openLeads.filter((l) => l.call_status === "not_called");
    const overdueUncalled = uncalledLeads.filter(
      (l) => Date.now() - new Date(l.submitted_at).getTime() >= 24 * 60 * 60 * 1000,
    );
    const pipelineLeads = leads.filter((l) => l.outcome === "quoted");
    const pipelineValue = pipelineLeads
      .reduce((sum, l) => sum + Number(l.quote_amount ?? 0), 0);
    const uncalledBySource = {
      website: uncalledLeads.filter((lead) => hasLeadSource(lead, "website")).length,
      meta: uncalledLeads.filter((lead) => hasLeadSource(lead, "meta")).length,
    };
    const overdueUncalledBySource = {
      website: overdueUncalled.filter((lead) => hasLeadSource(lead, "website")).length,
      meta: overdueUncalled.filter((lead) => hasLeadSource(lead, "meta")).length,
    };
    const pipelineBySource = {
      website: pipelineLeads
        .filter((lead) => hasLeadSource(lead, "website"))
        .reduce((sum, lead) => sum + Number(lead.quote_amount ?? 0), 0),
      meta: pipelineLeads
        .filter((lead) => hasLeadSource(lead, "meta"))
        .reduce((sum, lead) => sum + Number(lead.quote_amount ?? 0), 0),
    };
    const openQuoteCountBySource = {
      website: pipelineLeads.filter((lead) => hasLeadSource(lead, "website")).length,
      meta: pipelineLeads.filter((lead) => hasLeadSource(lead, "meta")).length,
    };
    const responseTimes = leads
      .filter((l) => l.first_call_at)
      .map((l) => new Date(l.first_call_at!).getTime() - new Date(l.submitted_at).getTime())
      .filter((duration) => duration >= 0);
    const averageResponseMs = responseTimes.length > 0
      ? responseTimes.reduce((sum, duration) => sum + duration, 0) / responseTimes.length
      : null;
    return {
      ...funnel,
      uncalled: uncalledLeads.length,
      uncalledBySource,
      overdueUncalled: overdueUncalled.length,
      overdueUncalledBySource,
      pipelineValue,
      pipelineBySource,
      openQuoteCount: pipelineLeads.length,
      openQuoteCountBySource,
      averageResponseMs,
    };
  }, [leads]);
  const metricsBySource = useMemo(() => calculateLeadFunnelBySource(leads), [leads]);

  const submissionRows = useMemo(
    () => leads.flatMap((lead) => lead.submissions?.length
      ? lead.submissions.map((submission) => ({
          source: submission.source,
          submitted_at: submission.submitted_at,
        }))
      : [{ source: lead.source, submitted_at: lead.submitted_at }]),
    [leads],
  );

  const trend = useMemo(
    () => trendRange === "custom"
      ? buildCustomLeadTrend(submissionRows, customFrom, customTo)
      : buildLeadTrend(submissionRows, trendRange),
    [submissionRows, trendRange, customFrom, customTo],
  );
  const trendLabel = TREND_RANGES.find((range) => range.value === trendRange)?.metricLabel ?? "period";
  const comparisonLabel = trendRange === "custom" ? "selected period" : trendLabel;
  const trendComparison = trend.previous.total === 0
    ? trend.current.total > 0 ? "No leads in the previous period" : "No leads in this period"
    : `${Math.abs(trend.changePct ?? 0)}% ${Number(trend.changePct) >= 0 ? "increase" : "decrease"} vs previous ${comparisonLabel}`;
  const sourceCounts = useMemo(() => ({
    all: leads.length,
    website: leads.filter((lead) => hasLeadSource(lead, "website")).length,
    meta: leads.filter((lead) => hasLeadSource(lead, "meta")).length,
  }), [leads]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  const selectTrendRange = (range: TrendSelection) => {
    if (range === "custom" && (!customFrom || !customTo)) {
      const defaults = defaultCustomDates();
      setCustomFrom(defaults.from);
      setCustomTo(defaults.to);
    }
    setTrendRange(range);
  };

  const toggleChartSource = (source: LeadSource) => {
    setChartSources((current) => {
      const other = source === "website" ? "meta" : "website";
      if (current[source] && !current[other]) return current;
      return { ...current, [source]: !current[source] };
    });
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Leads</h1>
          <p className="text-sm text-sand-500 mt-1">
            Track, contact, and convert website and Meta leads.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {metaStatus?.connected && metaStatus.subscribed && (
            <div className="flex items-center gap-2 text-xs text-sand-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{metaStatus.page_name ? `Meta: ${metaStatus.page_name}` : "Meta connected"}</span>
            </div>
          )}
          {metaStatus?.connected && metaStatus.can_sync && (
            <button
              type="button"
              onClick={syncMeta}
              disabled={syncingMeta}
              className="px-3 py-2 rounded-md border border-sand-300 bg-white text-sm font-medium text-sand-700 hover:bg-sand-50 disabled:opacity-60"
            >
              {syncingMeta ? "Syncing" : "Sync Meta"}
            </button>
          )}
        </div>
      </div>

      <section className="bg-white rounded-lg border border-sand-200/60 overflow-hidden">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(560px,1fr)]">
          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-sand-200/60 xl:border-r xl:border-sand-200/60">
            <SummaryMetric
              label={`New Leads (${trendLabel})`}
              value={trend.current.total}
              color="bg-blue-500"
              subtitle={trendComparison}
              sourceDetails={{
                website: {
                  value: trend.current.website,
                  detail: `${trend.current.total > 0 ? Math.round((trend.current.website / trend.current.total) * 100) : 0}% of period`,
                },
                meta: {
                  value: trend.current.meta,
                  detail: `${trend.current.total > 0 ? Math.round((trend.current.meta / trend.current.total) * 100) : 0}% of period`,
                },
              }}
            />
            <SummaryMetric
              label="Need a Call"
              value={metrics.uncalled}
              color={metrics.uncalled > 0 ? "bg-amber-400" : "bg-emerald-500"}
              subtitle={metrics.overdueUncalled > 0 ? `${metrics.overdueUncalled} waiting over 24 hours` : "No overdue calls"}
              sourceDetails={{
                website: {
                  value: metrics.uncalledBySource.website,
                  detail: `${metrics.overdueUncalledBySource.website} overdue`,
                },
                meta: {
                  value: metrics.uncalledBySource.meta,
                  detail: `${metrics.overdueUncalledBySource.meta} overdue`,
                },
              }}
            />
            <SummaryMetric
              label="Quoted Pipeline"
              value={formatCADWhole(metrics.pipelineValue)}
              color="bg-emerald-500"
              subtitle={`${metrics.openQuoteCount} open quotes`}
              sourceDetails={{
                website: {
                  value: formatCADShort(metrics.pipelineBySource.website),
                  detail: `${metrics.openQuoteCountBySource.website} quotes`,
                },
                meta: {
                  value: formatCADShort(metrics.pipelineBySource.meta),
                  detail: `${metrics.openQuoteCountBySource.meta} quotes`,
                },
              }}
            />
          </div>
          <FunnelComparison metrics={metricsBySource} />
        </div>
      </section>

      <section className="bg-white border border-sand-200 rounded-lg overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-3 border-b border-sand-200">
          <div>
            <h2 className="text-base font-semibold text-sand-900">Lead volume</h2>
            <p className="text-xs text-sand-500 mt-0.5">Website and Meta submissions over time</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 text-sand-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartSources.website}
                  disabled={chartSources.website && !chartSources.meta}
                  onChange={() => toggleChartSource("website")}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />
                Website
              </label>
              <label className="flex items-center gap-2 text-sand-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chartSources.meta}
                  disabled={chartSources.meta && !chartSources.website}
                  onChange={() => toggleChartSource("meta")}
                  className="w-4 h-4 accent-pink-600"
                />
                <span className="w-2.5 h-2.5 rounded-sm bg-pink-600" />
                Meta
              </label>
            </div>
            <div className="inline-flex self-start flex-wrap rounded-md border border-sand-200 bg-sand-50 p-0.5 text-[11px] font-medium">
              {TREND_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={trendRange === range.value}
                  onClick={() => selectTrendRange(range.value)}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    trendRange === range.value
                      ? "bg-white text-sand-900 shadow-sm"
                      : "text-sand-500 hover:text-sand-800"
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {trendRange === "custom" && (
          <div className="px-5 py-3 border-b border-sand-200 bg-sand-50 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-sand-600">
              From
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="block mt-1 px-3 py-2 rounded-md border border-sand-200 bg-white text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
            <label className="text-xs font-medium text-sand-600">
              To
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => setCustomTo(event.target.value)}
                className="block mt-1 px-3 py-2 rounded-md border border-sand-200 bg-white text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>
        )}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="h-[210px] px-3 pt-3 pb-1 sm:px-4">
            <LeadTrendChart
              data={trend.points}
              showWebsite={chartSources.website}
              showMeta={chartSources.meta}
            />
          </div>
          <div className="border-t lg:border-t-0 lg:border-l border-sand-200 px-4 py-3 flex flex-col justify-center gap-3">
            <SourceTotal label="Website" value={trend.current.website} total={trend.current.total} color="bg-blue-600" />
            <SourceTotal label="Meta" value={trend.current.meta} total={trend.current.total} color="bg-pink-600" />
            <div className="pt-3 border-t border-sand-200">
              <p className="text-xs text-sand-500">All sources</p>
              <p className="text-xl font-semibold text-sand-900 mt-0.5">{trend.current.total}</p>
              <p className="text-[11px] text-sand-500 mt-0.5">{trendComparison}</p>
            </div>
          </div>
        </div>
      </section>

      {(metaStatusError || metaStatus?.error || syncError) && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-lg text-sm text-red-800">
          <span className="font-medium">Meta sync needs attention. </span>
          {metaStatusError?.message ?? metaStatus?.error ?? syncError}
        </div>
      )}
      {syncResult && !syncError && (
        <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 rounded-lg text-sm text-emerald-800">
          Meta sync finished: {syncResult.inserted} imported, {syncResult.deduped} already present, {syncResult.failed} failed.
        </div>
      )}

      {leadsError && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-lg text-sm text-red-800">
          Could not load leads: {leadsError.message}
        </div>
      )}

      <section className="bg-white rounded-lg border border-sand-200 overflow-hidden">
        <div className="px-4 py-4 border-b border-sand-200">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold text-sand-900">Lead queue</h2>
              <p className="text-xs text-sand-500 mt-0.5">{filtered.length} leads in this view</p>
            </div>
            <p className="hidden sm:block text-xs text-sand-500">{formatDuration(metrics.averageResponseMs)}</p>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {FILTER_TABS.map((tab) => {
              const count = filterCounts[tab.value] ?? 0;
              const active = filter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? "text-blue-700 bg-blue-50"
                      : "text-sand-500 hover:text-sand-700 hover:bg-sand-50"
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-blue-100 text-blue-600" : "bg-sand-100 text-sand-500"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-3 border-b border-sand-200 bg-sand-50 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex self-start rounded-md border border-sand-200 bg-white p-0.5 text-xs font-medium">
            {(["all", "website", "meta"] as const).map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={sourceFilter === source}
                onClick={() => setSourceFilter(source)}
                className={`px-3 py-1.5 rounded transition-colors ${
                  sourceFilter === source ? "bg-sand-800 text-white" : "text-sand-600 hover:text-sand-900"
                }`}
              >
                {source === "all" ? "All" : SOURCE_BADGE[source].label} {sourceCounts[source]}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, or staff"
              aria-label="Search leads"
              className="w-full sm:w-64 px-3 py-2 text-sm border border-sand-200 rounded-md bg-white text-sand-700 placeholder-sand-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
              aria-label="Sort leads"
              className="px-3 py-2 text-sm border border-sand-200 rounded-md bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sand-400 text-sm">Loading leads…</div>
        ) : leadsError ? (
          <div className="py-12 text-center text-red-500 text-sm">Lead data is unavailable.</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sand-400 text-sm">
            {leads.length === 0
              ? sourceFilter === "meta"
                ? "No Meta leads have been imported yet."
                : sourceFilter === "website"
                  ? "No website leads have been received yet."
                  : "No leads have been received yet."
              : "No leads match this filter."}
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-sand-200/60">
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Lead</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Source</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Received</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Contact</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quote</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Staff</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Stage</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={`border-b border-sand-100 hover:bg-sand-50 cursor-pointer transition-colors ${
                      lead.call_status === "not_called" && lead.outcome !== "won" && lead.outcome !== "lost"
                        ? "border-l-2 border-l-amber-400"
                        : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-sand-900">{lead.name || "Unnamed"}</div>
                      <div className="text-[11px] text-sand-400 truncate max-w-[220px]">
                        {[lead.email, lead.phone].filter(Boolean).join(" · ")}
                      </div>
                      {(lead.duplicate_count ?? 1) > 1 && (
                        <div className="text-[11px] text-violet-600 mt-0.5">
                          {lead.duplicate_count} submissions combined
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {leadSources(lead).map((source) => (
                          <span key={source} className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[source].className}`}>
                            {SOURCE_BADGE[source].label}
                          </span>
                        ))}
                      </div>
                      {((lead.duplicate_count ?? 1) > 1 || lead.source_detail) && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[200px]">
                          {(lead.duplicate_count ?? 1) > 1
                            ? `${lead.duplicate_count} form submissions`
                            : lead.source_detail}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-600">
                      <div>{formatDate(lead.submitted_at)}</div>
                      <div className="text-[11px] text-sand-400">{timeAgo(lead.submitted_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${CALL_BADGE[lead.call_status]}`}>
                        {CALL_STATUS_LABELS[lead.call_status]}
                      </span>
                      {lead.last_called_by && lead.last_call_at && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[200px]">
                          {lead.last_called_by} · {timeAgo(lead.last_call_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.quote_number ? (
                        <>
                          <div className="font-medium text-sand-900">{lead.quote_number}</div>
                          {lead.quote_amount != null && (
                            <div className="text-[11px] text-sand-400">{formatCADWhole(Number(lead.quote_amount))}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-sand-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sand-600">
                      {lead.assigned_to ? (
                        <span className="block max-w-[160px] truncate" title={lead.assigned_to}>
                          {lead.assigned_to}
                        </span>
                      ) : (
                        <span className="text-sand-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                        {OUTCOME_LABELS[lead.outcome]}
                      </span>
                      {lead.outcome === "lost" && lead.lost_reason && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[160px]">{lead.lost_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedLeadId(lead.id); }}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        {lead.call_status === "not_called" ? "Log Call" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          onClose={() => setSelectedLeadId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

interface SourceMetricDetail {
  value: string | number;
  detail: string;
}

function SummaryMetric({
  label,
  value,
  color,
  subtitle,
  sourceDetails,
}: {
  label: string;
  value: string | number;
  color: string;
  subtitle?: string;
  sourceDetails: Record<LeadSource, SourceMetricDetail>;
}) {
  return (
    <div className="flex min-h-40 flex-col p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <p className="text-[11px] text-sand-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-semibold text-sand-900">{value}</p>
      {subtitle && <p className="text-[11px] text-sand-400 mt-0.5">{subtitle}</p>}
      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-sand-100 pt-3">
        {(["website", "meta"] as const).map((source) => (
          <div key={source} className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] text-sand-500">
              <span className={`w-2 h-2 rounded-sm ${source === "website" ? "bg-blue-600" : "bg-pink-600"}`} />
              <span className="capitalize">{source}</span>
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold text-sand-800" title={String(sourceDetails[source].value)}>
              {sourceDetails[source].value}
            </p>
            <p className="truncate text-[10px] text-sand-400" title={sourceDetails[source].detail}>
              {sourceDetails[source].detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const FUNNEL_COMPARISON_ROWS = [
  { label: "Call attempt", rate: "callRate", count: "attempted" },
  { label: "Quote rate", rate: "quoteRate", count: "quoted" },
  { label: "Order conversion", rate: "conversionRate", count: "won" },
] as const;

function FunnelComparison({ metrics }: { metrics: LeadFunnelMetricsBySource }) {
  return (
    <div className="border-t border-sand-200/60 xl:border-t-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-sand-200/60">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          <p className="text-[11px] text-sand-500 uppercase tracking-wider">Performance by source</p>
        </div>
        <span className="text-[10px] text-sand-400 uppercase tracking-wider">All-time</span>
      </div>
      <table className="w-full table-fixed text-left">
        <thead>
          <tr className="border-b border-sand-100">
            <th className="w-[42%] px-4 py-2 text-[10px] font-medium text-sand-400 uppercase tracking-wider">Metric</th>
            <th className="w-[29%] px-3 py-2 text-[11px] font-medium text-sand-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-blue-600" />
                Website
              </span>
            </th>
            <th className="w-[29%] px-3 py-2 text-[11px] font-medium text-sand-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-pink-600" />
                Meta
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {FUNNEL_COMPARISON_ROWS.map((row) => (
            <tr key={row.rate} className="border-b border-sand-100 last:border-b-0">
              <th className="px-4 py-2 text-xs font-medium text-sand-600">{row.label}</th>
              {(["website", "meta"] as const).map((source) => (
                <td key={source} className="px-3 py-2">
                  <span className="text-sm font-semibold text-sand-900">{metrics[source][row.rate]}%</span>
                  <span className="ml-2 text-[10px] text-sand-400 whitespace-nowrap">
                    {metrics[source][row.count]} / {metrics[source].total}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceTotal({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-sand-700">
          <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
          {label}
        </span>
        <span className="font-semibold text-sand-900">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 bg-sand-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${share}%` }} />
      </div>
      <p className="text-[10px] text-sand-400 mt-0.5">{share}% of leads</p>
    </div>
  );
}
