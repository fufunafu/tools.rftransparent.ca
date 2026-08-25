"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  isLeadInCustomDateRange,
  isLeadIncludedInPerformance,
  leadTrendQueryBounds,
  type LeadFunnelMetricsBySource,
  type LeadTrendQueryBounds,
  type LeadTrendRange,
} from "@/lib/lead-analytics";
import {
  buildLeadPerformanceTrend,
  type LeadPerformanceMetricKey,
  type LeadPerformanceTrendPoint,
} from "@/lib/lead-performance-trends";
import { formatCADShort, formatCADWhole } from "@/lib/format";
import { isCallablePhone } from "@/lib/call-metrics";
import { getAutomationDetailFailure } from "@/lib/automation-status";
import {
  LEAD_SPAM_REASON,
  isLeadSpamReason,
} from "@/lib/customer-service/lead-spam";
import {
  formatLeadResponseTime,
  leadResponseTimeMs,
  medianLeadResponseTimeMs,
} from "@/lib/lead-response-times";
import { redirectOnUnauthorized } from "@/lib/client-auth";
import { useRouter } from "next/navigation";
import {
  LEAD_STORE_OPTIONS,
  leadsPath,
  type LeadStoreId,
} from "@/lib/customer-service/lead-store";

const LeadTrendChart = dynamic(() => import("@/components/admin/LeadTrendChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-sand-50 rounded-md" />,
});

const LeadPerformanceTrendChart = dynamic(
  () => import("@/components/admin/LeadPerformanceTrendChart"),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse rounded-md bg-sand-50" />,
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const SOURCE_BADGE: Record<LeadSource, { label: string; className: string }> = {
  website: { label: "Website", className: "bg-blue-100 text-blue-700" },
  meta: { label: "Meta", className: "bg-rose-100 text-rose-700" },
};

type TrendSelection = LeadTrendRange | "custom";

const TREND_RANGES: { value: TrendSelection; label: string; metricLabel: string }[] = [
  { value: "7d", label: "7 days", metricLabel: "7 days" },
  { value: "30d", label: "30 days", metricLabel: "30 days" },
  { value: "90d", label: "90 days", metricLabel: "90 days" },
  { value: "12m", label: "12 months", metricLabel: "12 months" },
  { value: "all", label: "All time", metricLabel: "all time" },
  { value: "custom", label: "Custom", metricLabel: "custom" },
];

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

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

function formatCustomDateRange(from: string, to: string): string | null {
  if (!from || !to) return null;
  const [start, end] = from <= to ? [from, to] : [to, from];
  const format = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };
  return start === end ? format(start) : `${format(start)} to ${format(end)}`;
}

const OUTCOME_BADGE: Record<Outcome, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  quoted: "bg-indigo-100 text-indigo-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-slate-100 text-slate-500",
  not_applicable: "bg-stone-100 text-stone-600",
};

const CALL_BADGE: Record<CallStatus, string> = {
  not_called: "bg-amber-50 text-amber-700 border border-amber-200",
  no_answer: "bg-gray-100 text-gray-600 border border-gray-200",
  called: "bg-green-50 text-green-700 border border-green-200",
};

function isClosedOutcome(outcome: Outcome): boolean {
  return outcome === "won" || outcome === "lost" || outcome === "not_applicable";
}

function needsPhone(lead: Lead): boolean {
  return lead.call_status === "not_called"
    && !isClosedOutcome(lead.outcome)
    && !isCallablePhone(lead.phone);
}

function LeadResponseSummary({ lead }: { lead: Lead }) {
  if (lead.outcome === "not_applicable") {
    return <span className="text-[11px] text-sand-400">Not required</span>;
  }

  const callTime = leadResponseTimeMs(lead.submitted_at, lead.first_call_at);
  const quoteTime = leadResponseTimeMs(
    lead.submitted_at,
    lead.first_quote_at ?? lead.quote_sent_at,
  );

  return (
    <div className="space-y-1 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="w-9 text-sand-400">Call</span>
        <span className={callTime == null ? "text-sand-400" : "font-medium text-sand-700"}>
          {callTime == null ? "Pending" : formatLeadResponseTime(callTime)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-9 text-sand-400">Quote</span>
        <span className={quoteTime == null ? "text-sand-400" : "font-medium text-sand-700"}>
          {quoteTime == null ? "Pending" : formatLeadResponseTime(quoteTime)}
        </span>
      </div>
    </div>
  );
}

const FILTER_TABS: { value: string; label: string; match: (l: Lead) => boolean }[] = [
  { value: "all", label: "All", match: (l) => !isLeadSpamReason(l.not_applicable_reason) },
  { value: "installation", label: "Installation", match: (l) => l.installation_requested === true },
  { value: "uncalled", label: "Uncalled", match: (l) => l.call_status === "not_called" && !isClosedOutcome(l.outcome) && isCallablePhone(l.phone) },
  { value: "no_phone", label: "No Phone", match: needsPhone },
  { value: "no_quote", label: "Awaiting Quote", match: (l) => l.call_status !== "not_called" && !l.quote_number && !isClosedOutcome(l.outcome) },
  { value: "open_quote", label: "Open Quote", match: (l) => !!l.quote_number && l.outcome === "quoted" },
  { value: "won", label: "Won", match: (l) => l.outcome === "won" },
  { value: "lost", label: "Lost", match: (l) => l.outcome === "lost" },
  { value: "spam", label: "Spam", match: (l) => isLeadSpamReason(l.not_applicable_reason) },
  { value: "not_applicable", label: "Not Applicable", match: (l) => l.outcome === "not_applicable" },
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

interface SyncAllResult {
  completed: string[];
  errors: string[];
}

type SyncAutomationJob = "sync-calls" | "sync-followup" | "sync-lead-quotes";

interface SourceResponseMetrics {
  medianCallMs: number | null;
  callCount: number;
  medianQuoteMs: number | null;
  quoteCount: number;
  applicableCount: number;
  callEligibleCount: number;
}

type SourceResponseMetricsBySource = Record<LeadSource, SourceResponseMetrics>;

async function fetcher<T>(url: string): Promise<T> {
  const response = redirectOnUnauthorized(await fetch(url));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

function leadListUrl(bounds: LeadTrendQueryBounds | null, store: LeadStoreId): string | null {
  if (!bounds) return null;
  const params = new URLSearchParams({ store, to: bounds.to });
  if (bounds.from) params.set("from", bounds.from);
  return `/api/customer-service/leads?${params.toString()}`;
}

function leadResponsePerformanceUrl(bounds: LeadTrendQueryBounds | null, store: LeadStoreId): string | null {
  if (!bounds) return null;
  const params = new URLSearchParams({ view: "response_performance", store, to: bounds.to });
  if (bounds.from) params.set("from", bounds.from);
  return `/api/customer-service/leads?${params.toString()}`;
}

const STORE_STORAGE_KEY = "cs_store";

// The store lives in the URL (/customer-service/leads/rf or /bc). Switching
// navigates, and the choice is remembered for the phone page and for the
// bare /customer-service/leads redirect.
function useStoreNavigation(section?: "analysis") {
  const router = useRouter();
  return (next: LeadStoreId) => {
    try {
      window.localStorage.setItem(STORE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; navigation still applies the selection.
    }
    router.push(leadsPath(next, section));
  };
}

function StoreSelect({
  value,
  onChange,
}: {
  value: LeadStoreId;
  onChange: (store: LeadStoreId) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as LeadStoreId)}
      aria-label="Store"
      className="h-9 rounded-md border border-sand-300 bg-white px-3 text-sm font-medium text-sand-700 hover:bg-sand-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      {LEAD_STORE_OPTIONS.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  );
}

async function triggerSyncAutomation(job: SyncAutomationJob, label: string): Promise<void> {
  const response = redirectOnUnauthorized(await fetch("/api/settings/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job }),
  }));
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    detail?: string;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `${label} sync failed with status ${response.status}`);
  }

  const detailFailure = getAutomationDetailFailure(body.detail);
  if (detailFailure) throw new Error(detailFailure);
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
    && !submission.attachments?.some((attachment) => attachment.filename === detail.value)
  ));
  const uploadErrors = Array.isArray(submission.raw_payload.upload_errors)
    ? submission.raw_payload.upload_errors.filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      )
    : [];

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

        {submission.attachments && submission.attachments.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-sand-400 mb-2">Project drawing</p>
            <div className="space-y-2">
              {submission.attachments.map((attachment) => {
                const attachmentUrl = `/api/customer-service/leads/attachments/${attachment.id}`;
                return (
                  <div
                    key={attachment.id}
                    className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <a
                        href={attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm font-medium text-blue-800 hover:underline"
                        title={attachment.filename}
                      >
                        {attachment.filename}
                      </a>
                      <p className="mt-0.5 text-xs text-blue-600">
                        {formatFileSize(attachment.size_bytes)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        View
                      </a>
                      <a
                        href={`${attachmentUrl}?download=1`}
                        download={attachment.filename}
                        className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {uploadErrors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-amber-800">Drawing upload did not finish</p>
            {uploadErrors.map((error, index) => (
              <p key={`${error}-${index}`} className="mt-1 text-xs text-amber-700">{error}</p>
            ))}
          </div>
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
  onChanged: () => void | Promise<unknown>;
}) {
  const detailUrl = `/api/customer-service/leads?view=details&lead_id=${encodeURIComponent(lead.id)}`;
  const {
    data: detailData,
    error: detailError,
    isLoading: detailsLoading,
  } = useSWR<{ details: LeadSubmission[]; lead_ids: string[] }>(detailUrl, fetcher);
  const callAttemptLeadIds = detailData?.lead_ids?.length ? detailData.lead_ids : [lead.id];
  // Every edit below applies to the whole duplicate group, but the group's id
  // list only arrives with the details response — until then a save would
  // update just the primary row and leave the merged submissions behind.
  const groupPending = detailsLoading && (lead.duplicate_count ?? 1) > 1;
  const { data: attemptsData } = useSWR<{ attempts: LeadCallAttempt[] }>(
    `/api/customer-service/leads?view=call_attempts&lead_ids=${encodeURIComponent(callAttemptLeadIds.join(","))}&since=${encodeURIComponent(lead.submitted_at)}`,
    fetcher
  );
  const attempts = attemptsData?.attempts ?? [];

  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(lead.quote_number ?? "");
  const [quoteAmount, setQuoteAmount] = useState(lead.quote_amount?.toString() ?? "");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(lead.phone ?? "");
  const [savingOutcome, setSavingOutcome] = useState<Outcome | null>(null);
  const [savingSpam, setSavingSpam] = useState(false);
  const [savingInstallation, setSavingInstallation] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const phoneIsCallable = isCallablePhone(lead.phone);
  const spamMarked = isLeadSpamReason(lead.not_applicable_reason);
  const displayName = lead.name?.trim() || lead.email?.split("@")[0] || lead.phone || "Lead";
  const submissions = useMemo(
    () => {
      const values = detailData?.details?.length
        ? detailData.details
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
            installation_requested: lead.installation_requested,
            raw_payload: lead.raw_payload,
            submitted_at: lead.submitted_at,
            attachments: lead.attachments,
          }];
      return [...values].sort(
        (left, right) => new Date(right.submitted_at).getTime() - new Date(left.submitted_at).getTime(),
      );
    },
    [detailData?.details, lead],
  );
  const firstQuoteAt = lead.first_quote_at ?? lead.quote_sent_at;
  const timeToFirstCall = leadResponseTimeMs(lead.submitted_at, lead.first_call_at);
  const timeToFirstQuote = leadResponseTimeMs(lead.submitted_at, firstQuoteAt);

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

  const patchLead = async (
    update: Record<string, unknown>,
    allSubmissions = false,
  ): Promise<boolean> => {
    if (allSubmissions && groupPending) {
      setSaveError("Still loading this lead's combined submissions — try again in a moment.");
      return false;
    }
    setSaveError(null);
    try {
      const response = redirectOnUnauthorized(await fetch("/api/customer-service/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(allSubmissions
            ? { ids: callAttemptLeadIds }
            : { id: lead.id }),
          ...update,
        }),
      }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? `Could not save changes (${response.status})`);
      }
      await onChanged();
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save changes");
      return false;
    }
  };

  const handleOutcomeChange = async (outcome: Outcome) => {
    if (outcome === lead.outcome || savingOutcome) return;
    setSavingOutcome(outcome);
    await patchLead({ outcome }, true);
    setSavingOutcome(null);
  };

  const handleSpamToggle = async () => {
    if (savingSpam) return;
    setSavingSpam(true);
    await patchLead(spamMarked
      ? { outcome: "new", not_applicable_reason: null }
      : { outcome: "not_applicable", not_applicable_reason: LEAD_SPAM_REASON }, true);
    setSavingSpam(false);
  };

  const handleSaveQuote = async () => {
    const savedQuoteNumber = quoteNumber.trim();
    const savedQuoteAmount = quoteAmount.trim() ? Number(quoteAmount) : null;
    if (savedQuoteAmount != null && (!Number.isFinite(savedQuoteAmount) || savedQuoteAmount < 0)) {
      setSaveError("Enter a valid non-negative quote amount");
      return;
    }
    const saved = await patchLead({
      quote_number: savedQuoteNumber || null,
      quote_amount: savedQuoteAmount,
      quote_sent_at: savedQuoteNumber
        ? lead.first_quote_at ?? lead.quote_sent_at ?? new Date().toISOString()
        : null,
      outcome: savedQuoteNumber && !isClosedOutcome(lead.outcome) ? "quoted" : lead.outcome,
    }, true);
    if (saved) setEditingQuote(false);
  };

  const handleSavePhone = async () => {
    const phone = phoneNumber.trim();
    if (!isCallablePhone(phone)) return;
    const saved = await patchLead({ phone }, true);
    if (saved) setEditingPhone(false);
  };

  const handleInstallationToggle = async () => {
    if (savingInstallation) return;
    setSavingInstallation(true);
    await patchLead({
      installation_requested: lead.installation_requested === true ? null : true,
    }, true);
    setSavingInstallation(false);
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
                {SOURCE_BADGE[lead.source].label} lead
              </p>
              <h2 id="lead-detail-title" className="mt-1 text-2xl font-semibold tracking-tight text-sand-900 truncate">
                {displayName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                  {OUTCOME_LABELS[lead.outcome]}
                </span>
                {spamMarked && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                    Spam
                  </span>
                )}
                {lead.outcome !== "not_applicable" && needsPhone(lead) ? (
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                    No phone
                  </span>
                ) : lead.outcome !== "not_applicable" && (
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CALL_BADGE[lead.call_status]}`}>
                    {CALL_STATUS_LABELS[lead.call_status]}
                  </span>
                )}
                {(lead.duplicate_count ?? 1) > 1 && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                    {lead.duplicate_count} submissions combined
                  </span>
                )}
                {lead.installation_requested === true && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                    Installation requested
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
          {editingPhone ? (
            <div className="rounded-lg border border-sand-200 bg-white p-2">
              <input
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="Phone number"
                aria-label="Lead phone number"
                autoFocus
                className="w-full rounded border border-sand-200 px-2.5 py-1.5 text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPhoneNumber(lead.phone ?? "");
                    setEditingPhone(false);
                  }}
                  className="px-2 py-1 text-xs font-medium text-sand-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePhone}
                  disabled={!isCallablePhone(phoneNumber) || groupPending}
                  className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save phone
                </button>
              </div>
            </div>
          ) : phoneIsCallable ? (
            <a
              href={`tel:${lead.phone}`}
              className="text-center px-4 py-2.5 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Call {lead.phone}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setEditingPhone(true)}
              className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5 text-center text-sm font-semibold text-orange-800 hover:bg-orange-100"
            >
              + Add phone number
            </button>
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

        <section className="px-5 sm:px-6 py-4 border-b border-sand-200">
          <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 ${
            lead.installation_requested === true
              ? "border-teal-200 bg-teal-50"
              : "border-sand-200 bg-sand-50"
          }`}>
            <div>
              <h3 className={`text-sm font-semibold ${
                lead.installation_requested === true ? "text-teal-900" : "text-sand-800"
              }`}>
                {lead.installation_requested === true
                  ? "Installation requested"
                  : lead.installation_requested === false
                    ? "Installation not requested"
                    : "Installation preference not recorded"}
              </h3>
              <p className={`mt-1 text-xs ${
                lead.installation_requested === true ? "text-teal-700" : "text-sand-500"
              }`}>
                {lead.installation_requested === true
                  ? "This lead should be included in the installation queue."
                  : "Use the button for an older lead or a preference received outside the form."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleInstallationToggle}
              disabled={savingInstallation || groupPending}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                lead.installation_requested === true
                  ? "border border-teal-300 bg-white text-teal-800 hover:bg-teal-100"
                  : "bg-teal-700 text-white hover:bg-teal-800"
              }`}
            >
              {savingInstallation
                ? "Saving..."
                : lead.installation_requested === true
                  ? "Remove installation mark"
                  : "Mark installation requested"}
            </button>
          </div>
        </section>

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
            <div className="min-w-0">
              <dt className="text-xs text-sand-400">Time to first call</dt>
              <dd className="mt-1 font-medium text-sand-800">
                {timeToFirstCall == null ? "Not called yet" : formatLeadResponseTime(timeToFirstCall)}
              </dd>
              {lead.first_call_at && (
                <dd className="mt-0.5 text-[11px] text-sand-400">{formatDateTime(lead.first_call_at)}</dd>
              )}
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-sand-400">Time to first quote</dt>
              <dd className="mt-1 font-medium text-sand-800">
                {timeToFirstQuote == null ? "Not quoted yet" : formatLeadResponseTime(timeToFirstQuote)}
              </dd>
              {firstQuoteAt && (
                <dd className="mt-0.5 text-[11px] text-sand-400">{formatDateTime(firstQuoteAt)}</dd>
              )}
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
            {detailsLoading ? (
              <div
                className="flex items-center gap-3 rounded-xl border border-sand-200 bg-sand-50 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <span
                  className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sand-300 border-t-blue-600"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-sand-700">Loading submission details...</p>
                  <p className="mt-0.5 text-xs text-sand-500">Fetching form answers and attachments.</p>
                </div>
              </div>
            ) : detailError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Submission details could not be loaded.
              </p>
            ) : (
              submissions.map((submission, index) => (
                <SubmissionCard
                  key={submission.id}
                  submission={submission}
                  position={index + 1}
                  total={submissions.length}
                />
              ))
            )}
          </div>
        </section>

        {/* Call log */}
        <section className="px-5 sm:px-6 py-6 border-b border-sand-200 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Call activity</h3>
            <span className="text-xs text-sand-400">{attempts.length} {attempts.length === 1 ? "call" : "calls"}</span>
          </div>
          {attempts.length === 0 ? (
            lead.outcome === "not_applicable" ? (
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-700">No call required</p>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  This lead is marked Not Applicable and is excluded from the call queue.
                </p>
              </div>
            ) : needsPhone(lead) ? (
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-sm font-medium text-orange-900">No phone number available</p>
                <p className="mt-1 text-xs leading-5 text-orange-700">
                  This lead is excluded from the call queue. Add a phone number above if one becomes available.
                </p>
              </div>
            ) : (
              <div className={`rounded-xl border p-4 ${lead.phone ? "border-sand-200 bg-sand-50" : "border-amber-200 bg-amber-50"}`}>
                <p className={`text-sm font-medium ${lead.phone ? "text-sand-700" : "text-amber-900"}`}>No calls linked to this lead</p>
                <p className={`text-xs mt-1 leading-5 ${lead.phone ? "text-sand-500" : "text-amber-700"}`}>
                  {lead.phone
                    ? "Automatic phone matching has not found a call after this submission."
                    : "No phone number was captured from the form or a linked quote, so automatic call matching cannot identify it."}
                </p>
              </div>
            )
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

        </section>

        {/* Quote */}
        <section className="px-5 sm:px-6 py-6 border-b border-sand-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Quote</h3>
            {!editingQuote && lead.outcome !== "not_applicable" && (
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
                min="0"
                step="0.01"
                value={quoteAmount}
                onChange={(e) => setQuoteAmount(e.target.value)}
                placeholder="Amount (CAD)"
                className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingQuote(false)} className="px-3 py-1.5 text-xs text-sand-600">Cancel</button>
                <button onClick={handleSaveQuote} disabled={groupPending} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded disabled:cursor-wait disabled:opacity-60">Save</button>
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
          ) : lead.outcome === "not_applicable" ? (
            <p className="text-sm text-stone-500">No quote required for a Not Applicable lead.</p>
          ) : (
            <p className="text-sm text-sand-400">No quote sent yet.</p>
          )}
        </section>

        {/* Outcome */}
        <section className="px-5 sm:px-6 py-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs text-sand-500 uppercase tracking-wider font-semibold">Outcome</h3>
            <button
              type="button"
              onClick={handleSpamToggle}
              disabled={savingSpam || savingOutcome !== null || groupPending}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                spamMarked
                  ? "border-sand-300 bg-white text-sand-600 hover:bg-sand-50"
                  : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              }`}
            >
              {savingSpam ? "Saving..." : spamMarked ? "Restore from spam" : "Mark as spam"}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => handleOutcomeChange(o)}
                disabled={savingOutcome !== null || groupPending}
                aria-pressed={(savingOutcome ?? lead.outcome) === o}
                className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                  (savingOutcome ?? lead.outcome) === o
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-sand-200 text-sand-600 hover:bg-sand-50 disabled:cursor-wait disabled:opacity-60"
                }`}
              >
                {savingOutcome === o ? "Saving..." : OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
          {saveError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {saveError}
            </p>
          )}
          {(lead.outcome === "lost" || lead.outcome === "not_applicable") && (
            <input
              type="text"
              defaultValue={lead.outcome === "lost"
                ? lead.lost_reason ?? ""
                : lead.not_applicable_reason ?? ""}
              onBlur={(e) => {
                const val = e.target.value.trim();
                const savedValue = lead.outcome === "lost"
                  ? lead.lost_reason ?? ""
                  : lead.not_applicable_reason ?? "";
                if (val === savedValue) return;
                patchLead(lead.outcome === "lost"
                  ? { lost_reason: val || null }
                  : { not_applicable_reason: val || null }, true);
              }}
              placeholder={lead.outcome === "lost" ? "Lost reason" : "Reason, such as spam, forwarded, or unquotable"}
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          )}
          <textarea
            defaultValue={lead.notes ?? ""}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val !== (lead.notes ?? "")) patchLead({ notes: val || null }, true);
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

export default function LeadsDashboard({
  initialLeads,
  initialNow,
  initialBounds,
  store,
}: {
  initialLeads?: Lead[] | null;
  initialNow: number;
  initialBounds: LeadTrendQueryBounds | null;
  store: LeadStoreId;
}) {
  const setStore = useStoreNavigation();
  // Only RF runs Meta lead ads; BC is website-only.
  const hasMeta = store === "rf_transparent";
  const [filter, setFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | LeadSource>("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [trendRange, setTrendRange] = useState<TrendSelection>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [chartSources, setChartSources] = useState({ website: true, meta: true });
  const [selectedPerformanceMetric, setSelectedPerformanceMetric] = useState<LeadPerformanceMetricKey | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllResult, setSyncAllResult] = useState<SyncAllResult | null>(null);
  const [now, setNow] = useState(initialNow);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Background refresh: SWR pauses polling while the tab is hidden
  // (refreshWhenHidden defaults to false) and revalidateOnFocus catches up
  // when it becomes visible again — overriding the provider-wide opt-out.
  const autoRefreshOpts = {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    focusThrottleInterval: 30_000,
  };
  const requestedBounds = useMemo(
    () => leadTrendQueryBounds(trendRange, new Date(now), customFrom, customTo),
    [trendRange, now, customFrom, customTo],
  );
  const leadsUrl = leadListUrl(requestedBounds, store);
  const initialLeadsUrl = leadListUrl(initialBounds, store);
  const { data, error: leadsError, isLoading } = useSWR<{ leads: Lead[] }>(
    leadsUrl,
    fetcher,
    {
      ...autoRefreshOpts,
      fallbackData: initialLeads && leadsUrl === initialLeadsUrl
        ? { leads: initialLeads }
        : undefined,
    },
  );
  const {
    data: metaStatus,
    error: metaStatusError,
    mutate: refreshMetaStatus,
  } = useSWR<MetaStatus>(hasMeta ? "/api/customer-service/leads?view=meta_status" : null, fetcher, autoRefreshOpts);
  const leads = useMemo(
    () => (hydrated ? data?.leads : leadsUrl === initialLeadsUrl ? initialLeads : null) ?? [],
    [data?.leads, hydrated, initialLeads, initialLeadsUrl, leadsUrl],
  );
  const rawCallPerformanceSelected = selectedPerformanceMetric === "medianCallMs";
  const {
    data: responsePerformanceData,
    error: responsePerformanceError,
    isLoading: responsePerformanceLoading,
  } = useSWR<{
    leads: Lead[];
    tracking_started_at: string | null;
  }>(
    rawCallPerformanceSelected ? leadResponsePerformanceUrl(requestedBounds, store) : null,
    fetcher,
    autoRefreshOpts,
  );
  const { mutate } = useSWRConfig();

  const refresh = () => (
    mutate((key) => typeof key === "string" && key.startsWith("/api/customer-service/leads"))
  );

  const syncAll = async () => {
    setSyncingAll(true);
    setSyncAllResult(null);
    const completed: string[] = [];
    const errors: string[] = [];

    try {
      if (!hasMeta) {
        // Nothing to pull for BC; phone/Shopify syncs below still apply.
      } else if (metaStatus?.connected) {
        try {
          const response = redirectOnUnauthorized(await fetch("/api/customer-service/leads?action=sync_meta", {
            method: "POST",
          }));
          const body = await response.json().catch(() => ({})) as {
            error?: string;
            summary?: MetaSyncSummary;
          };
          if (!response.ok || !body.summary) {
            throw new Error(body.error ?? `Meta sync failed with status ${response.status}`);
          }
          completed.push(`Meta (${body.summary.inserted} imported)`);
          if (body.summary.failed > 0) {
            errors.push(`Meta: ${body.summary.failed} lead${body.summary.failed === 1 ? "" : "s"} failed`);
          }
        } catch (error) {
          errors.push(`Meta: ${error instanceof Error ? error.message : "sync failed"}`);
        }
      } else {
        errors.push("Meta: not connected");
      }

      const automationResults = await Promise.allSettled([
        triggerSyncAutomation("sync-calls", "Phone"),
        // Quote matching runs on its own so a slow Shopify import cannot
        // stop leads from being linked to their quotes.
        triggerSyncAutomation("sync-followup", "Shopify")
          .finally(() => triggerSyncAutomation("sync-lead-quotes", "Quotes")),
      ]);
      for (const [index, result] of automationResults.entries()) {
        const label = index === 0 ? "Phone" : "Shopify";
        if (result.status === "fulfilled") {
          completed.push(label);
        } else {
          const message = result.reason instanceof Error ? result.reason.message : "sync failed";
          errors.push(`${label}: ${message}`);
        }
      }

      const refreshResults = await Promise.allSettled([refresh(), refreshMetaStatus()]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        errors.push("Lead data could not be refreshed after syncing");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncAllResult({ completed, errors });
      setSyncingAll(false);
    }
  };

  const trend = useMemo(
    () => trendRange === "custom"
      ? buildCustomLeadTrend(leads, customFrom, customTo, new Date(now))
      : buildLeadTrend(leads, trendRange, new Date(now)),
    [leads, trendRange, customFrom, customTo, now],
  );
  const analysisLeads = useMemo(() => {
    const firstPoint = trend.points[0];
    const lastPoint = trend.points.at(-1);
    return firstPoint && lastPoint
      ? leads.filter((lead) => isLeadInCustomDateRange(
          lead,
          firstPoint.rangeStart,
          lastPoint.rangeEnd,
        ))
      : [];
  }, [leads, trend]);
  const queueLeads = analysisLeads;

  const sourceLeads = useMemo(
    () => sourceFilter === "all"
      ? queueLeads
      : queueLeads.filter((lead) => lead.source === sourceFilter),
    [queueLeads, sourceFilter],
  );

  const filtered = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.value === filter) ?? FILTER_TABS[0];
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

  const queueResponseMetrics = useMemo(() => {
    const visibleLeads = filtered.filter(isLeadIncludedInPerformance);
    const callTimes = visibleLeads
      .map((lead) => leadResponseTimeMs(lead.submitted_at, lead.first_call_at))
      .filter((duration): duration is number => duration != null);
    const quoteTimes = visibleLeads
      .map((lead) => leadResponseTimeMs(
        lead.submitted_at,
        lead.first_quote_at ?? lead.quote_sent_at,
      ))
      .filter((duration): duration is number => duration != null);
    return {
      medianCallMs: medianLeadResponseTimeMs(callTimes),
      medianQuoteMs: medianLeadResponseTimeMs(quoteTimes),
    };
  }, [filtered]);

  const filterCounts: Record<string, number> = useMemo(() => {
    const result: Record<string, number> = {};
    for (const tab of FILTER_TABS) {
      result[tab.value] = sourceLeads.filter((l) => tab.match(l)).length;
    }
    return result;
  }, [sourceLeads]);

  const metrics = useMemo(() => {
    const funnel = calculateLeadFunnel(analysisLeads);
    const openLeads = analysisLeads.filter((l) => !isClosedOutcome(l.outcome));
    const uncalledLeads = openLeads.filter((l) => (
      l.call_status === "not_called" && isCallablePhone(l.phone)
    ));
    const overdueUncalled = uncalledLeads.filter(
      (l) => now - new Date(l.submitted_at).getTime() >= 24 * 60 * 60 * 1000,
    );
    const pipelineLeads = analysisLeads.filter((l) => l.outcome === "quoted");
    const pipelineValue = pipelineLeads
      .reduce((sum, l) => sum + Number(l.quote_amount ?? 0), 0);
    const uncalledBySource = {
      website: uncalledLeads.filter((lead) => lead.source === "website").length,
      meta: uncalledLeads.filter((lead) => lead.source === "meta").length,
    };
    const overdueUncalledBySource = {
      website: overdueUncalled.filter((lead) => lead.source === "website").length,
      meta: overdueUncalled.filter((lead) => lead.source === "meta").length,
    };
    const pipelineBySource = {
      website: pipelineLeads
        .filter((lead) => lead.source === "website")
        .reduce((sum, lead) => sum + Number(lead.quote_amount ?? 0), 0),
      meta: pipelineLeads
        .filter((lead) => lead.source === "meta")
        .reduce((sum, lead) => sum + Number(lead.quote_amount ?? 0), 0),
    };
    const openQuoteCountBySource = {
      website: pipelineLeads.filter((lead) => lead.source === "website").length,
      meta: pipelineLeads.filter((lead) => lead.source === "meta").length,
    };
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
    };
  }, [analysisLeads, now]);
  const metricsBySource = useMemo(
    () => calculateLeadFunnelBySource(analysisLeads),
    [analysisLeads],
  );
  const responseMetricsBySource = useMemo<SourceResponseMetricsBySource>(() => {
    const summarize = (source: LeadSource): SourceResponseMetrics => {
      const applicableLeads = analysisLeads.filter((lead) => (
        lead.source === source && isLeadIncludedInPerformance(lead)
      ));
      const callTimes = applicableLeads.map((lead) => (
        leadResponseTimeMs(lead.submitted_at, lead.first_call_at)
      ));
      const quoteTimes = applicableLeads.map((lead) => leadResponseTimeMs(
        lead.submitted_at,
        lead.first_quote_at ?? lead.quote_sent_at,
      ));
      return {
        medianCallMs: medianLeadResponseTimeMs(callTimes),
        callCount: callTimes.filter((duration) => duration != null).length,
        medianQuoteMs: medianLeadResponseTimeMs(quoteTimes),
        quoteCount: quoteTimes.filter((duration) => duration != null).length,
        applicableCount: applicableLeads.length,
        callEligibleCount: applicableLeads.filter((lead) => (
          lead.call_status !== "not_called" || isCallablePhone(lead.phone)
        )).length,
      };
    };
    return { website: summarize("website"), meta: summarize("meta") };
  }, [analysisLeads]);
  const performanceTrend = useMemo(
    () => buildLeadPerformanceTrend(
      rawCallPerformanceSelected ? responsePerformanceData?.leads ?? [] : leads,
      trend.points,
    ),
    [leads, rawCallPerformanceSelected, responsePerformanceData?.leads, trend.points],
  );

  const trendLabel = TREND_RANGES.find((range) => range.value === trendRange)?.metricLabel ?? "period";
  const comparisonLabel = trendRange === "custom" ? "selected period" : trendLabel;
  const trendComparison = trendRange === "all"
    ? "All recorded leads"
    : trend.previous.total === 0
    ? trend.current.total > 0 ? "No leads in the previous period" : "No leads in this period"
    : `${Math.abs(trend.changePct ?? 0)}% ${Number(trend.changePct) >= 0 ? "increase" : "decrease"} vs previous ${comparisonLabel}`;
  const sourceCounts = useMemo(() => ({
    all: queueLeads.length,
    website: queueLeads.filter((lead) => lead.source === "website").length,
    meta: queueLeads.filter((lead) => lead.source === "meta").length,
  }), [queueLeads]);
  const selectedDateRange = trend.points[0] && trend.points.at(-1)
    ? formatCustomDateRange(trend.points[0].rangeStart, trend.points.at(-1)!.rangeEnd)
    : null;

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

  const selectChartRange = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setTrendRange("custom");
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Leads</h1>
          <p className="text-sm text-sand-500 mt-1">
            {hasMeta
              ? "Track, contact, and convert website and Meta leads."
              : "Track, contact, and convert BC Transparent website leads."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StoreSelect value={store} onChange={setStore} />
          {hasMeta && metaStatus?.connected && metaStatus.subscribed && (
            <div className="flex items-center gap-2 text-xs text-sand-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{metaStatus.page_name ? `Meta: ${metaStatus.page_name}` : "Meta connected"}</span>
            </div>
          )}
          <Link
            href={leadsPath(store, "analysis")}
            className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15.5V11m4.5 4.5V7.5m4.5 8V4m4.5 11.5V9" />
            </svg>
            Analysis
          </Link>
          {(hasMeta ? metaStatus?.can_sync : true) && (
            <button
              type="button"
              onClick={syncAll}
              disabled={syncingAll}
              className="min-w-[88px] px-3 py-2 rounded-md border border-sand-300 bg-white text-sm font-medium text-sand-700 hover:bg-sand-50 disabled:cursor-wait disabled:opacity-60"
            >
              {syncingAll ? "Syncing..." : "Sync All"}
            </button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(420px,440px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="order-2 overflow-hidden rounded-lg border border-sand-200/60 bg-white">
            <div className="grid divide-y divide-sand-200/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <SummaryMetric
              label={`New Leads (${trendLabel})`}
              value={trend.current.total}
              color="bg-blue-500"
              subtitle={trendComparison}
              sourceDetails={{
                website: {
                  value: trend.current.website,
                },
                meta: {
                  value: trend.current.meta,
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
                },
                meta: {
                  value: metrics.uncalledBySource.meta,
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
                },
                meta: {
                  value: formatCADShort(metrics.pipelineBySource.meta),
                },
              }}
            />
            </div>
            <FunnelComparison
              metrics={metricsBySource}
              responseMetrics={responseMetricsBySource}
              periodLabel={selectedDateRange ?? trendLabel}
              onSelectMetric={setSelectedPerformanceMetric}
            />
          </section>

          <section className="order-1 overflow-hidden rounded-lg border border-sand-200 bg-white">
        <div className="flex flex-col justify-between gap-2.5 border-b border-sand-200 px-4 py-2.5 lg:flex-row lg:items-center xl:items-stretch xl:flex-col">
          <div>
            <h2 className="text-base font-semibold text-sand-900">Lead volume</h2>
            <p className="text-xs text-sand-500 mt-0.5">{hasMeta ? "Website and Meta leads" : "Website leads"}; matching submissions within 7 days count once</p>
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center xl:items-start xl:flex-col">
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
            <div className="inline-flex max-w-full flex-nowrap self-start overflow-x-auto rounded-md border border-sand-200 bg-sand-50 p-0.5 text-[11px] font-medium">
              {TREND_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={trendRange === range.value}
                  onClick={() => selectTrendRange(range.value)}
                    className={`shrink-0 px-2.5 py-1 rounded transition-colors ${
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
            <div className="h-[150px] px-3 pb-1 pt-2.5 sm:px-4">
              <LeadTrendChart
                data={trend.points}
                showWebsite={chartSources.website}
                showMeta={chartSources.meta}
                onSelectRange={selectChartRange}
              />
            </div>
            <div className="grid gap-3 border-t border-sand-200 px-3 py-2.5 sm:grid-cols-3">
              <SourceTotal label="Website" value={trend.current.website} total={trend.current.total} color="bg-blue-600" />
              <SourceTotal label="Meta" value={trend.current.meta} total={trend.current.total} color="bg-pink-600" />
              <div className="border-t border-sand-200 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <p className="text-xs text-sand-500">All sources</p>
                <p className="mt-0.5 text-xl font-semibold text-sand-900">{trend.current.total}</p>
                <p className="mt-0.5 text-[11px] text-sand-500">{trendComparison}</p>
              </div>
            </div>
          </section>

      {hasMeta && (metaStatusError || metaStatus?.error) && (
        <div className="order-3 border border-red-200 bg-red-50 px-4 py-3 rounded-lg text-sm text-red-800">
          <span className="font-medium">Meta connection needs attention. </span>
          {metaStatusError?.message ?? metaStatus?.error}
        </div>
      )}
      {syncAllResult && (
        <div
          role={syncAllResult.errors.length > 0 ? "alert" : "status"}
          aria-live="polite"
          className={`order-3 border px-4 py-3 rounded-lg text-sm ${
          syncAllResult.errors.length > 0
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {syncAllResult.errors.length > 0 ? (
            <>
              <span className="font-medium">Sync finished with issues. </span>
              {syncAllResult.errors.join(". ")}.
              {syncAllResult.completed.length > 0 && ` Refreshed: ${syncAllResult.completed.join(", ")}.`}
            </>
          ) : (
            <>Sync finished: {syncAllResult.completed.join(", ")}.</>
          )}
        </div>
      )}

      {leadsError && (
        <div className="order-3 border border-red-200 bg-red-50 px-4 py-3 rounded-lg text-sm text-red-800">
          Could not load leads: {leadsError.message}
        </div>
      )}
        </div>

        <section className="min-w-0 overflow-hidden rounded-lg border border-sand-200 bg-white xl:sticky xl:top-6">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-sand-200">
          <div>
            <h2 className="text-base font-semibold text-sand-900">Lead queue</h2>
            <p className="text-xs text-sand-500 mt-0.5">
              {filtered.length === queueLeads.length
                ? `${queueLeads.length} leads`
                : `${filtered.length} of ${queueLeads.length} leads`}
              {selectedDateRange ? ` | ${selectedDateRange}` : ""}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-xs text-sand-500">
            <span>
              Median call <strong className="font-semibold text-sand-700">{formatLeadResponseTime(queueResponseMetrics.medianCallMs)}</strong>
            </span>
            <span className="h-4 w-px bg-sand-200" aria-hidden="true" />
            <span>
              Median quote <strong className="font-semibold text-sand-700">{formatLeadResponseTime(queueResponseMetrics.medianQuoteMs)}</strong>
            </span>
          </div>
        </div>
        <div className="border-b border-sand-200 bg-sand-50 px-3 py-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, phone, or staff"
              aria-label="Search leads"
              className="h-9 min-w-[220px] flex-[1_1_260px] rounded-md border border-sand-200 bg-white px-3 text-xs text-sand-700 placeholder-sand-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="Filter leads by status"
              className="h-9 w-full rounded-md border border-sand-200 bg-white px-2.5 text-xs text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400 sm:w-[180px]"
            >
              {FILTER_TABS.map((tab) => (
                <option key={tab.value} value={tab.value}>
                  {tab.label} ({filterCounts[tab.value] ?? 0})
                </option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as "all" | LeadSource)}
              aria-label="Filter leads by source"
              className="h-9 w-full rounded-md border border-sand-200 bg-white px-2.5 text-xs text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400 sm:w-[150px]"
            >
              <option value="all">All sources ({sourceCounts.all})</option>
              <option value="website">Website ({sourceCounts.website})</option>
              {hasMeta && <option value="meta">Meta ({sourceCounts.meta})</option>}
            </select>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
              aria-label="Sort leads"
              className="h-9 w-full rounded-md border border-sand-200 bg-white px-2.5 text-xs text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400 sm:w-[130px]"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            {(filter !== "all" || sourceFilter !== "all" || search.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setSourceFilter("all");
                  setSearch("");
                }}
                className="h-9 whitespace-nowrap px-2 text-[11px] font-medium text-blue-600 hover:text-blue-800"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {isLoading && data == null ? (
          <div className="py-12 text-center text-sand-400 text-sm">Loading leads…</div>
        ) : leadsError ? (
          <div className="py-12 text-center text-red-500 text-sm">Lead data is unavailable.</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sand-400 text-sm">
            {leads.length === 0
              ? "No leads have been received yet."
              : queueLeads.length === 0
                ? "No leads were received in this date range."
                : sourceLeads.length === 0
                  ? `No ${sourceFilter === "meta" ? "Meta" : "website"} leads were received in this date range.`
                  : "No leads match this filter."}
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full min-w-[880px] table-fixed text-sm">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-sand-200/60">
                  <th className="w-[23%] px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-sand-400">Lead</th>
                  <th className="w-[9%] px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-sand-400">Received</th>
                  <th className="w-[16%] px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-sand-400">Response</th>
                  <th className="w-[14%] px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-sand-400">Contact</th>
                  <th className="w-[18%] px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-sand-400">Quote / Staff</th>
                  <th className="w-[12%] px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-sand-400">Stage</th>
                  <th className="w-[8%] px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={`border-b border-sand-100 hover:bg-sand-50 cursor-pointer transition-colors ${
                      lead.call_status === "not_called" && !isClosedOutcome(lead.outcome) && isCallablePhone(lead.phone)
                        ? "border-l-2 border-l-amber-400"
                        : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-sand-900">
                        <span className="truncate">{lead.name || "Unnamed"}</span>
                        <span
                          role="img"
                          aria-label={`${SOURCE_BADGE[lead.source].label} lead`}
                          title={`${SOURCE_BADGE[lead.source].label}${lead.source_detail ? `: ${lead.source_detail}` : ""}`}
                          className={`h-2.5 w-2.5 shrink-0 rounded-sm ${lead.source === "website" ? "bg-blue-600" : "bg-pink-600"}`}
                        />
                      </div>
                      <div className="text-[11px] text-sand-400 truncate max-w-[220px]">
                        {[lead.email, lead.phone].filter(Boolean).join(" · ")}
                      </div>
                      {(lead.duplicate_count ?? 1) > 1 && (
                        <div className="text-[11px] text-violet-600 mt-0.5">
                          {lead.duplicate_count} submissions combined
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sand-600">
                      <div>{formatDate(lead.submitted_at)}</div>
                      <div className="text-[11px] text-sand-400">{timeAgo(lead.submitted_at, now)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <LeadResponseSummary lead={lead} />
                    </td>
                    <td className="px-4 py-3">
                      {lead.outcome === "not_applicable" ? (
                        <span className="inline-block rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-600">
                          Not required
                        </span>
                      ) : needsPhone(lead) ? (
                        <span className="inline-block rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                          No phone
                        </span>
                      ) : (
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${CALL_BADGE[lead.call_status]}`}>
                          {CALL_STATUS_LABELS[lead.call_status]}
                        </span>
                      )}
                      {lead.last_called_by && lead.last_call_at && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[200px]">
                          {lead.last_called_by} · {timeAgo(lead.last_call_at, now)}
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
                      <div className="mt-1 truncate text-[11px] text-sand-400" title={lead.assigned_to || "Unassigned"}>
                        Staff: <span className="text-sand-600">{lead.assigned_to || "Unassigned"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                        {OUTCOME_LABELS[lead.outcome]}
                      </span>
                      {lead.outcome === "lost" && lead.lost_reason && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[160px]">{lead.lost_reason}</div>
                      )}
                      {lead.outcome === "not_applicable" && lead.not_applicable_reason && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[160px]">{lead.not_applicable_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedLeadId(lead.id); }}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
      </div>

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          onClose={() => setSelectedLeadId(null)}
          onChanged={refresh}
        />
      )}
      {selectedPerformanceMetric && (
        <PerformanceTrendDialog
          metric={selectedPerformanceMetric}
          data={performanceTrend}
          periodLabel={selectedDateRange ?? trendLabel}
          trendRange={trendRange}
          onSelectRange={selectTrendRange}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
          chartSources={chartSources}
          onToggleSource={toggleChartSource}
          responseTrackingStartedAt={responsePerformanceData?.tracking_started_at ?? null}
          responseDataLoading={responsePerformanceLoading}
          responseDataError={responsePerformanceError?.message ?? null}
          onClose={() => setSelectedPerformanceMetric(null)}
        />
      )}
    </>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

interface SourceMetricDetail {
  value: string | number;
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
    <div className="flex min-w-0 flex-col p-2.5">
      <div>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
          <p className="truncate text-[10px] uppercase tracking-wider text-sand-400" title={label}>{label}</p>
        </div>
        <p className="text-lg font-semibold leading-5 text-sand-900">{value}</p>
        {subtitle && <p className="mt-0.5 truncate text-[10px] leading-4 text-sand-400" title={subtitle}>{subtitle}</p>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-sand-100 pt-1.5">
        {(["website", "meta"] as const).map((source) => (
          <div key={source} className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] text-sand-500">
              <span className={`h-2 w-2 shrink-0 rounded-sm ${source === "website" ? "bg-blue-600" : "bg-pink-600"}`} />
              <span className="truncate capitalize">{source}</span>
            </div>
            <p className="truncate text-xs font-semibold leading-4 text-sand-800" title={String(sourceDetails[source].value)}>
              {sourceDetails[source].value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const FUNNEL_COMPARISON_ROWS = [
  { label: "Call attempt (callable)", rate: "callRate", count: "attempted", denominator: "callEligible" },
  { label: "Quote rate (included)", rate: "quoteRate", count: "quoted", denominator: "total" },
  { label: "Lead-to-order (included)", rate: "conversionRate", count: "won", denominator: "total" },
] as const;

const RESPONSE_COMPARISON_ROWS = [
  { label: "Median elapsed to call", value: "medianCallMs", count: "callCount", denominator: "callEligibleCount" },
  { label: "Median elapsed to quote", value: "medianQuoteMs", count: "quoteCount", denominator: "applicableCount" },
] as const;

const PERFORMANCE_METRIC_DETAILS: Record<LeadPerformanceMetricKey, {
  title: string;
  description: string;
}> = {
  callRate: {
    title: "Call attempt rate",
    description: "Share of callable leads with at least one call attempt. Higher is better.",
  },
  quoteRate: {
    title: "Quote rate",
    description: "Share of included leads that received a quote. Higher is better.",
  },
  conversionRate: {
    title: "Lead-to-order rate",
    description: "Share of included leads that became an order. Higher is better.",
  },
  medianCallMs: {
    title: "Median elapsed to call",
    description: "Median elapsed time among leads with a completed first call. Lower is better.",
  },
  medianQuoteMs: {
    title: "Median elapsed to quote",
    description: "Median elapsed time among leads with a completed first quote. Lower is better.",
  },
};

function performanceRateWindow(
  trendRange: TrendSelection,
  customFrom: string,
  customTo: string,
): { size: number; label: string } {
  if (trendRange === "7d") return { size: 3, label: "3-day rolling rate" };
  if (trendRange === "30d") return { size: 7, label: "7-day rolling rate" };
  if (trendRange === "90d") return { size: 4, label: "4-week rolling rate" };
  if (trendRange === "12m" || trendRange === "all") {
    return { size: 3, label: "3-month rolling rate" };
  }

  const start = Date.parse(`${customFrom}T00:00:00.000Z`);
  const end = Date.parse(`${customTo}T00:00:00.000Z`);
  const spanDays = Number.isFinite(start) && Number.isFinite(end)
    ? Math.floor(Math.abs(end - start) / 86_400_000) + 1
    : 30;
  if (spanDays > 180) return { size: 3, label: "3-month rolling rate" };
  if (spanDays > 45) return { size: 4, label: "4-week rolling rate" };
  if (spanDays >= 14) return { size: 7, label: "7-day rolling rate" };
  if (spanDays >= 5) return { size: 3, label: "3-day rolling rate" };
  return { size: 1, label: "Daily cohort rate" };
}

function formatTrendStart(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
}

function FunnelComparison({
  metrics,
  responseMetrics,
  periodLabel,
  onSelectMetric,
}: {
  metrics: LeadFunnelMetricsBySource;
  responseMetrics: SourceResponseMetricsBySource;
  periodLabel: string;
  onSelectMetric: (metric: LeadPerformanceMetricKey) => void;
}) {
  return (
    <div className="border-t border-sand-200/60">
      <div className="flex items-center justify-between gap-3 border-b border-sand-200/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          <p className="text-[11px] text-sand-500 uppercase tracking-wider">Performance by source</p>
        </div>
        <span className="text-[10px] text-sand-400 uppercase tracking-wider">{periodLabel}</span>
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
            <tr
              key={row.rate}
              onClick={() => onSelectMetric(row.rate)}
              className="group cursor-pointer border-b border-sand-100 transition-colors last:border-b-0 hover:bg-indigo-50/50 focus-within:bg-indigo-50/50"
            >
              <th className="px-4 py-1.5 text-xs font-medium text-sand-600">
                <MetricTrendButton
                  label={row.label}
                  onClick={() => onSelectMetric(row.rate)}
                />
              </th>
              {(["website", "meta"] as const).map((source) => (
                <td key={source} className="px-3 py-1.5">
                  <span className="text-sm font-semibold text-sand-900">{metrics[source][row.rate]}%</span>
                  <span className="ml-2 whitespace-nowrap text-[10px] text-sand-400">
                    {metrics[source][row.count]} / {metrics[source][row.denominator]}
                  </span>
                </td>
              ))}
            </tr>
          ))}
          {RESPONSE_COMPARISON_ROWS.map((row) => (
            <tr
              key={row.value}
              onClick={() => onSelectMetric(row.value)}
              className="group cursor-pointer border-b border-sand-100 transition-colors last:border-b-0 hover:bg-indigo-50/50 focus-within:bg-indigo-50/50"
            >
              <th className="px-4 py-1.5 text-xs font-medium text-sand-600">
                <MetricTrendButton
                  label={row.label}
                  onClick={() => onSelectMetric(row.value)}
                />
              </th>
              {(["website", "meta"] as const).map((source) => (
                <td key={source} className="px-3 py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="whitespace-nowrap text-sm font-semibold text-sand-900">
                      {formatLeadResponseTime(responseMetrics[source][row.value])}
                    </span>
                    <span className="whitespace-nowrap text-[10px] text-sand-400">
                      {responseMetrics[source][row.count]} / {responseMetrics[source][row.denominator]} completed
                    </span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-sand-100 px-4 py-2 text-[10px] leading-4 text-sand-400">
        Historical imports are included in performance rates. Spam, forwarded, and unquotable leads remain excluded.
        Rates use the current stage of leads first submitted in this period, so recent cohorts are still maturing.
        Response medians include completed responses only and measure elapsed time, including nights and weekends.
      </p>
    </div>
  );
}

function MetricTrendButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`View ${label} trend`}
      title={`View ${label} trend`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex w-full items-center justify-between gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <span>{label}</span>
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-sand-300 transition-colors group-hover:text-indigo-500 group-focus-within:text-indigo-500"
      >
        <path
          d="M3 14.5 7.25 10l3 2.5L17 5.75M13 5.75h4v4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    </button>
  );
}

function PerformanceTrendDialog({
  metric,
  data,
  periodLabel,
  trendRange,
  customFrom,
  customTo,
  onSelectRange,
  onCustomFromChange,
  onCustomToChange,
  chartSources,
  onToggleSource,
  responseTrackingStartedAt,
  responseDataLoading,
  responseDataError,
  onClose,
}: {
  metric: LeadPerformanceMetricKey;
  data: LeadPerformanceTrendPoint[];
  periodLabel: string;
  trendRange: TrendSelection;
  customFrom: string;
  customTo: string;
  onSelectRange: (range: TrendSelection) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  chartSources: Record<LeadSource, boolean>;
  onToggleSource: (source: LeadSource) => void;
  responseTrackingStartedAt: string | null;
  responseDataLoading: boolean;
  responseDataError: string | null;
  onClose: () => void;
}) {
  const details = PERFORMANCE_METRIC_DETAILS[metric];
  const rateMetric = metric === "callRate" || metric === "quoteRate" || metric === "conversionRate";
  const rollingWindow = performanceRateWindow(trendRange, customFrom, customTo);
  const responseStarts = !rateMetric
    ? (["website", "meta"] as const).flatMap((source) => {
        const first = data.find((point) => point[source][metric] != null);
        return first ? [`${source === "website" ? "Website" : "Meta"} ${formatTrendStart(first.rangeStart)}`] : [];
      })
    : [];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-[1px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="performance-trend-title"
        aria-describedby="performance-trend-description"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-sand-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-5 border-b border-sand-200 px-5 py-4 sm:px-6">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-sand-400">
                Performance trend
              </p>
            </div>
            <h2 id="performance-trend-title" className="text-xl font-semibold text-sand-900">
              {details.title}
            </h2>
            <p id="performance-trend-description" className="mt-1 text-sm text-sand-500">
              {details.description}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close performance trend"
            className="rounded-md p-2 text-sand-400 transition-colors hover:bg-sand-100 hover:text-sand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
              <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto">
          <div className="flex flex-col gap-3 border-b border-sand-100 bg-sand-50/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="inline-flex max-w-full flex-nowrap self-start overflow-x-auto rounded-md border border-sand-200 bg-white p-0.5 text-[11px] font-medium">
              {TREND_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={trendRange === range.value}
                  onClick={() => onSelectRange(range.value)}
                  className={`shrink-0 rounded px-2.5 py-1 transition-colors ${
                    trendRange === range.value
                      ? "bg-indigo-50 text-indigo-700 shadow-sm"
                      : "text-sand-500 hover:text-sand-800"
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] uppercase tracking-wider text-sand-400">{periodLabel}</p>
          </div>

          {trendRange === "custom" && (
            <div className="flex flex-wrap items-end gap-3 border-b border-sand-100 px-5 py-3 sm:px-6">
              <label className="text-xs font-medium text-sand-600">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(event) => onCustomFromChange(event.target.value)}
                  className="mt-1 block rounded-md border border-sand-200 bg-white px-3 py-2 text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="text-xs font-medium text-sand-600">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(event) => onCustomToChange(event.target.value)}
                  className="mt-1 block rounded-md border border-sand-200 bg-white px-3 py-2 text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
            </div>
          )}

          <div className="px-3 pb-3 pt-5 sm:px-6 sm:pb-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2 text-xs text-sand-600">
              <div className="flex items-center gap-5">
                <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={chartSources.website}
                  disabled={chartSources.website && !chartSources.meta}
                  onChange={() => onToggleSource("website")}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                <span className="h-0.5 w-5 bg-blue-600" />
                Website
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={chartSources.meta}
                  disabled={chartSources.meta && !chartSources.website}
                  onChange={() => onToggleSource("meta")}
                  className="h-3.5 w-3.5 accent-pink-600"
                />
                <span className="h-0.5 w-5 bg-pink-600" />
                Meta
                </label>
              </div>
              <span className="rounded-full bg-sand-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-sand-500">
                {rateMetric
                  ? rollingWindow.label
                  : responseDataLoading
                    ? "Loading recorded responses"
                  : responseStarts.length > 0
                    ? `Recorded data: ${responseStarts.join(" · ")}`
                    : "No recorded response data"}
              </span>
            </div>
            <div className="h-[330px] w-full">
              {responseDataLoading && !rateMetric ? (
                <div className="h-full animate-pulse rounded-lg bg-sand-50" />
              ) : responseDataError && !rateMetric ? (
                <div className="flex h-full items-center justify-center rounded-lg bg-red-50 px-5 text-center text-sm text-red-700">
                  Recorded response data could not be loaded: {responseDataError}
                </div>
              ) : (
                <LeadPerformanceTrendChart
                  data={data}
                  metric={metric}
                  showWebsite={chartSources.website}
                  showMeta={chartSources.meta}
                  rollingWindowSize={rollingWindow.size}
                />
              )}
            </div>
          </div>

          <p className="border-t border-sand-100 px-5 py-3 text-[11px] leading-5 text-sand-400 sm:px-6">
            {rateMetric
              ? `Each point recomputes the rate from all leads in the preceding ${rollingWindow.label.replace(" rolling rate", "")} window. The first points use the days available so far, so the chart starts immediately. This reduces misleading daily jumps caused by small samples.`
              : responseTrackingStartedAt
                ? `Phone response tracking begins ${formatDateTime(responseTrackingStartedAt)}. Earlier lead cohorts are omitted because phone history before that point is unavailable. Each point is the median for leads first submitted in that period.`
                : "Each point is the median for leads first submitted in that period."}
            {" "}Recent groups may improve as calls, quotes, and orders are completed. Hover or tap a point to see the exact value and sample size.
          </p>
        </div>
      </section>
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
