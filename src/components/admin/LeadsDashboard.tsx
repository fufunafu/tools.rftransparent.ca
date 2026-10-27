"use client";

import Link from "next/link";
import LeadFilterDropdown, { filterSelections } from "./LeadFilterDropdown";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { isLeadInCustomDateRange, leadTrendQueryBounds, type LeadTrendQueryBounds } from "@/lib/lead-analytics";
import { hasUnansweredReply, isFollowUpDue, isOpenLead, leadMatchesOwner } from "@/lib/customer-service/lead-queue";
import { formatCADWhole } from "@/lib/format";
import { isCallablePhone } from "@/lib/call-metrics";
import {
  LEAD_NO_CALL_INSTALLATION_REASON,
  LEAD_SPAM_REASON,
  isLeadSpamReason,
} from "@/lib/customer-service/lead-spam";
import {
  formatLeadResponseTime,
  leadResponseTimeMs,
} from "@/lib/lead-response-times";
import { redirectOnUnauthorized } from "@/lib/client-auth";
import { useRouter } from "next/navigation";
import {
  LEAD_STORE_COOKIE,
  LEAD_STORE_OPTIONS,
  leadStoreLabel,
  leadsPath,
  type LeadStoreId,
} from "@/lib/customer-service/lead-store";

const LeadAnalysisDashboard = dynamic(() => import("./LeadAnalysisDashboard"), {
  loading: () => <p className="p-4 text-sm text-sand-500">Loading analytics...</p>,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
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

const SOURCE_BADGE: Record<LeadSource, { label: string; className: string }> = {
  website: { label: "Website", className: "bg-blue-100 text-blue-700" },
  meta: { label: "Meta", className: "bg-rose-100 text-rose-700" },
  outreach: { label: "Outreach", className: "bg-violet-100 text-violet-700" },
};

export const LEAD_ROWS_PER_PAGE = 50;

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

// Historical imports were worked outside the tool; still show whatever the
// phone and quote syncs recovered for them instead of "Not required".
function isHistoricalImport(lead: Lead): boolean {
  return Boolean(lead.raw_payload?.historical_import);
}

function LeadResponseSummary({ lead }: { lead: Lead }) {
  if (lead.outcome === "not_applicable" && !isHistoricalImport(lead)) {
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
  { value: "open", label: "Open leads", match: isOpenLead },
  { value: "overdue", label: "Follow-ups due", match: () => true },
  { value: "replies", label: "Unanswered replies", match: () => true },
  { value: "all", label: "All except spam", match: (l) => !isLeadSpamReason(l.not_applicable_reason) },
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

async function fetcher<T>(url: string): Promise<T> {
  const response = redirectOnUnauthorized(await fetch(url));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

function leadListUrl(bounds: LeadTrendQueryBounds | null, store: LeadStoreId, includeOlderOpen = false): string | null {
  if (!bounds) return null;
  const params = new URLSearchParams({ store, to: bounds.to, include_open: String(includeOlderOpen) });
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
      document.cookie = `${LEAD_STORE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
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
  store,
  onClose,
  onChanged,
  currentUserEmail,
}: {
  lead: Lead;
  store: LeadStoreId;
  currentUserEmail: string;
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

  const [owner, setOwner] = useState(lead.assigned_to ?? "");
  const [nextAction, setNextAction] = useState(lead.next_action ?? "");
  const [followUp, setFollowUp] = useState(() => {
    if (!lead.next_follow_up_at) return "";
    const date = new Date(lead.next_follow_up_at);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [savingPlan, setSavingPlan] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(lead.quote_number ?? "");
  const [quoteAmount, setQuoteAmount] = useState(lead.quote_amount?.toString() ?? "");
  const [quoteDate, setQuoteDate] = useState(() => {
    if (!lead.quote_sent_at) return "";
    const date = new Date(lead.quote_sent_at);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(lead.phone ?? "");
  const [savingOutcome, setSavingOutcome] = useState<Outcome | null>(null);
  const [savingSpam, setSavingSpam] = useState(false);
  const [savingQuickAction, setSavingQuickAction] = useState<"called" | "no_call" | "transfer" | null>(null);
  const [savingInstallation, setSavingInstallation] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const phoneIsCallable = isCallablePhone(lead.phone);
  const spamMarked = isLeadSpamReason(lead.not_applicable_reason);
  const noCallMarked = lead.not_applicable_reason === LEAD_NO_CALL_INSTALLATION_REASON;
  const otherStore: LeadStoreId = store === "rf_transparent" ? "bc_transparent" : "rf_transparent";
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

  // Quick actions requested by the sales team: record a call the phone sync
  // missed, park an Ontario installation request that needs no sales call,
  // or hand the lead to the other store's queue.
  const handleMarkCalled = async () => {
    if (savingQuickAction) return;
    setSavingQuickAction("called");
    await patchLead({
      call_status: "called",
      ...(lead.outcome === "new" ? { outcome: "contacted" } : {}),
    }, true);
    setSavingQuickAction(null);
  };

  const handleNoCallToggle = async () => {
    if (savingQuickAction) return;
    setSavingQuickAction("no_call");
    await patchLead(noCallMarked
      ? { outcome: "new", not_applicable_reason: null }
      : {
          outcome: "not_applicable",
          not_applicable_reason: LEAD_NO_CALL_INSTALLATION_REASON,
          installation_requested: true,
        }, true);
    setSavingQuickAction(null);
  };

  const handleTransfer = async () => {
    if (savingQuickAction) return;
    setSavingQuickAction("transfer");
    const saved = await patchLead({ store_id: otherStore }, true);
    setSavingQuickAction(null);
    // The lead now lives in the other store's list, so this panel is stale.
    if (saved) onClose();
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
      quote_sent_at: savedQuoteNumber && quoteDate ? new Date(quoteDate).toISOString() : null,
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

        <section className="space-y-3 border-b border-sand-200 px-5 py-5 sm:px-6">
          <h3 className="text-sm font-semibold text-sand-900">Owner and next step</h3>
          <form className="space-y-3" onSubmit={async (event) => {
            event.preventDefault(); setSavingPlan(true); setPlanSaved(false);
            if (followUp && !nextAction.trim()) { setSaveError("Add a next action for the scheduled follow-up."); setSavingPlan(false); return; }
            const saved = await patchLead({ assigned_to: owner.trim() || null, next_action: nextAction.trim() || null,
              next_follow_up_at: followUp ? new Date(followUp).toISOString() : null }, true);
            setSavingPlan(false); setPlanSaved(saved);
          }}>
            <label className="block text-xs text-sand-600">Owner email or name<input value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={200} className="mt-1 block w-full rounded border border-sand-200 px-3 py-2 text-sm" /></label>
            {currentUserEmail && <button type="button" onClick={() => setOwner(currentUserEmail)} className="text-xs text-blue-700">Assign to me</button>}
            <label className="block text-xs text-sand-600">Next action<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={1000} placeholder="Call to confirm measurements" className="mt-1 block w-full rounded border border-sand-200 px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-sand-600">Follow-up date and time (your local time)<input type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} className="mt-1 block w-full rounded border border-sand-200 px-3 py-2 text-sm" /></label>
            <div className="flex items-center gap-3"><button disabled={savingPlan || groupPending} className="rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{savingPlan ? "Saving..." : "Save next step"}</button>{planSaved && <span role="status" className="text-xs text-green-700">Saved</span>}</div>
          </form>
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
              <label className="block text-xs text-sand-500">Actual send date (optional, local time)<input type="datetime-local" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} className="mt-1 block w-full rounded border border-sand-200 px-3 py-2 text-sm" /></label>
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
                  <span className="text-sand-500">Lead owner</span>
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleMarkCalled}
              disabled={savingQuickAction !== null || groupPending || lead.call_status === "called"}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              title="Record that this lead was called when the phone sync did not catch it"
            >
              {savingQuickAction === "called" ? "Saving..." : lead.call_status === "called" ? "Marked as called" : "Mark as called"}
            </button>
            <button
              type="button"
              onClick={handleNoCallToggle}
              disabled={savingQuickAction !== null || groupPending}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-60 ${
                noCallMarked
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-teal-200 bg-white text-teal-700 hover:bg-teal-50"
              }`}
              title="Ontario installation request handled by the installation team; no sales call needed"
            >
              {savingQuickAction === "no_call" ? "Saving..." : noCallMarked ? "Ontario installation (no call) ✓" : "Ontario installation, no call"}
            </button>
            <button
              type="button"
              onClick={handleTransfer}
              disabled={savingQuickAction !== null || groupPending}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
              title={`Move this lead to the ${leadStoreLabel(otherStore)} leads page`}
            >
              {savingQuickAction === "transfer" ? "Sending..." : `Send to ${otherStore === "bc_transparent" ? "BC" : "RF"}`}
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

function LoadMoreRows({
  shown,
  total,
  onLoadMore,
}: {
  shown: number;
  total: number;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <div ref={sentinel} className="flex items-center justify-center gap-3 py-4 text-xs text-sand-400">
      <span>Showing {shown} of {total} leads</span>
      <button
        type="button"
        onClick={onLoadMore}
        className="font-medium text-blue-600 hover:text-blue-800"
      >
        Show more
      </button>
    </div>
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export default function LeadsDashboard({ initialLeads, initialNow, initialBounds, store, currentUserEmail = "" }: {
  initialLeads?: Lead[] | null;
  initialNow: number;
  initialBounds: LeadTrendQueryBounds | null;
  store: LeadStoreId;
  currentUserEmail?: string;
}) {
  const setStore = useStoreNavigation();
  const [filters, setFilters] = useState({ status: "open", source: "all", owner: "all", search: "", sort: "newest", history: "30d", olderOpen: "false" });
  const [classicView, setClassicView] = useState(false);
  const [viewRestored, setViewRestored] = useState(false);
  useEffect(() => {
    // Restore browser-only preferences after hydration to match the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setClassicView(localStorage.getItem("lead-layout") === "classic"); } catch { /* Optional preference. */ }
    setViewRestored(true);
  }, []);
  useEffect(() => {
    if (viewRestored) try { localStorage.setItem("lead-layout", classicView ? "classic" : "compact"); } catch { /* Optional preference. */ }
  }, [classicView, viewRestored]);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [restored, setRestored] = useState(false);
  const [now, setNow] = useState(initialNow);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const storageKey = `rf-lead-queue:v2:${store}`;
  useEffect(() => {
    // Restore only after hydration so the server and first client render agree.
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved === "object") {
        const allowed: Record<string, string[]> = { status: FILTER_TABS.map((tab) => tab.value), source: ["all", "website", "meta", "outreach"], owner: ["all", "mine", "unassigned", "others"], sort: ["newest", "oldest"], history: ["30d", "90d", "all"], olderOpen: ["false", "true"] };
        // Restore session preferences only after the initial server-matching render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFilters((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key,
          key === "search" ? typeof saved[key] === "string" ? saved[key].slice(0, 200) : value
          : ["status", "source", "owner"].includes(key) && typeof saved[key] === "string"
            ? saved[key].split(",").filter((item: string) => allowed[key]?.includes(item)).join(",")
            : allowed[key]?.includes(saved[key]) ? saved[key] : value])) as typeof current);
      }
    } catch { /* Storage can be unavailable in private browsing. */ }
    setRestored(true);
  }, [storageKey]);
  useEffect(() => { if (restored) try { sessionStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* Optional persistence. */ } }, [filters, restored, storageKey]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const change = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const bounds = useMemo(() => leadTrendQueryBounds(filters.history as "30d" | "90d" | "all", new Date(now)), [filters.history, now]);
  const url = leadListUrl(bounds, store, filters.olderOpen === "true");
  const initialUrl = leadListUrl(initialBounds, store);
  const { data, error, isLoading, mutate: reload, isValidating } = useSWR<{ leads: Lead[] }>(url, fetcher, {
    refreshInterval: 60_000, revalidateOnFocus: true,
    fallbackData: initialLeads && url === initialUrl ? { leads: initialLeads } : undefined,
    revalidateOnMount: initialLeads && url === initialUrl ? false : undefined,
  });
  const leads = useMemo(() => data?.leads ?? [], [data?.leads]);
  const queue = useMemo(() => leads.filter((lead) =>
    !bounds?.from || isLeadInCustomDateRange(lead, bounds.from, bounds.to)
      || (filters.olderOpen === "true" && isOpenLead(lead))), [leads, bounds, filters.olderOpen]);
  const open = queue.filter((lead) => isOpenLead(lead) && !isLeadSpamReason(lead.not_applicable_reason));
  const sources = filterSelections(filters.source, ["website", "meta", "outreach"]);
  const statuses = filterSelections(filters.status, FILTER_TABS.filter(item => item.value !== "all" && item.value !== "spam").map(item => item.value));
  const owners = filterSelections(filters.owner, ["mine", "unassigned", "others"]);
  const sourceLeads = queue.filter((lead) => sources.includes(lead.source));
  const scoped = sourceLeads.filter((lead) => owners.some(owner => owner === "others"
    ? !!lead.assigned_to?.trim() && !leadMatchesOwner(lead, "mine", currentUserEmail)
    : leadMatchesOwner(lead, owner, currentUserEmail)));
  const visible = scoped.filter((lead) => {
    const spam = isLeadSpamReason(lead.not_applicable_reason);
    if (spam && !statuses.includes("spam")) return false;
    if (!spam && !statuses.some(status => status === "overdue" ? isFollowUpDue(lead, now)
      : status === "replies" ? isOpenLead(lead) && hasUnansweredReply(lead)
      : FILTER_TABS.find(item => item.value === status)?.match(lead))) return false;
    const q = filters.search.trim().toLowerCase();
    if (!q) return true;
    const text = [lead.name, lead.email, lead.phone, lead.assigned_to, lead.next_action, lead.quote_number].filter(Boolean).join(" ").toLowerCase();
    const phoneQuery = q.replace(/\D/g, "");
    return text.includes(q) || (phoneQuery.length >= 4 && (lead.phone ?? "").replace(/\D/g, "").includes(phoneQuery));
  }).sort((a, b) => (Date.parse(b.submitted_at) - Date.parse(a.submitted_at)) * (filters.sort === "oldest" ? -1 : 1));
  const pagingKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: pagingKey, count: LEAD_ROWS_PER_PAGE });
  const count = paging.key === pagingKey ? paging.count : LEAD_ROWS_PER_PAGE;
  const showMore = useCallback(() => setPaging((old) => ({ key: pagingKey, count: (old.key === pagingKey ? old.count : LEAD_ROWS_PER_PAGE) + LEAD_ROWS_PER_PAGE })), [pagingKey]);
  const selected = leads.find((lead) => lead.id === selectedLeadId);
  const refresh = () => mutate((key) => typeof key === "string" && key.startsWith("/api/customer-service/leads"));
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyMessage(`${label} copied.`); }
    catch { setCopyMessage("Copy was unavailable. Select the contact text to copy it."); }
  };
  const setQuickView = (status: string, owner = "all") => setFilters((current) => ({ ...current, status, owner, source: "all", search: "" }));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-sand-900">Leads</h1><p className="mt-1 text-sm text-sand-500">Call, reply, and follow up. Choose a received date range for your work queue.</p></div>
      <div className="flex flex-wrap gap-2"><StoreSelect value={store} onChange={setStore} /><button type="button" aria-pressed={classicView} onClick={() => setClassicView((value) => !value)} className="rounded-md border border-sand-300 bg-white px-3 py-2 text-sm text-sand-700">{classicView ? "Switch to compact view" : "Switch to old view"}</button><Link href={leadsPath(store, "analysis")} className="rounded-md border border-indigo-200 px-3 py-2 text-sm text-indigo-700">Analysis</Link><button onClick={() => { void reload(); }} disabled={isValidating} className="rounded-md border border-sand-300 px-3 py-2 text-sm">{isValidating ? "Refreshing..." : "Refresh"}</button></div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{ label: "Open leads", value: open.length, status: "open" }, { label: "Follow-ups due", value: open.filter((lead) => isFollowUpDue(lead, now)).length, status: "overdue" }, { label: "Need a call", value: open.filter((lead) => lead.call_status === "not_called" && isCallablePhone(lead.phone)).length, status: "uncalled" }, { label: "Unassigned", value: open.filter((lead) => !lead.assigned_to?.trim()).length, status: "open", owner: "unassigned" }].map((card) => <button key={card.label} onClick={() => setQuickView(card.status, card.owner)} className="rounded-lg border border-sand-200 bg-white p-3 text-left hover:border-indigo-300"><span className="text-xs text-sand-500">{card.label}</span><span className="mt-1 block text-2xl font-semibold tabular-nums text-sand-900">{card.value}</span></button>)}
    </div>
    <div data-lead-layout={classicView ? "classic" : "compact"} className={classicView ? "grid items-start gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.65fr)]" : "space-y-4"}>
    <section className={classicView ? "min-w-0 rounded-lg border border-sand-200 bg-white xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto" : "rounded-lg border border-sand-200 bg-white"}>
      {classicView ? <div className="border-b border-sand-100 px-4 py-3"><h2 className="text-sm font-semibold text-sand-900">Analytics</h2><p className="text-xs text-sand-500">Date filters apply to analytics only.</p></div> : <>
      <button type="button" aria-expanded={showAnalytics} aria-controls="lead-analytics" onClick={() => setShowAnalytics((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span><span className="block text-sm font-semibold text-sand-900">Analytics</span><span className="text-xs text-sand-500">Lead volume, source performance, conversion, and response times</span></span>
        <span className="shrink-0 text-xs font-medium text-blue-700">{showAnalytics ? "Hide analytics" : "Show analytics"}</span>
      </button>
      </>}
      {(classicView || showAnalytics) && <div id="lead-analytics" className="border-t border-sand-100 p-3 sm:p-4"><LeadAnalysisDashboard embedded sidePanel={classicView} initialNow={initialNow} initialBounds={initialBounds} store={store} /></div>}
    </section>
    <div className="min-w-0 space-y-4">
    <section className="rounded-lg border border-sand-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-100 px-4 py-3"><div><h2 className="font-semibold text-sand-900">Work queue</h2><p className="text-xs text-sand-500">{visible.length} {visible.length === 1 ? "lead" : "leads"} matching filters · {filters.history === "all" ? "Received at any time" : `Received in the last ${filters.history === "90d" ? "90" : "30"} days${filters.olderOpen === "true" ? " + older open leads" : ""}`}</p></div></div>
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-100 p-3">
        <input value={filters.search} onChange={(event) => change("search", event.target.value)} placeholder="Search name, email, phone, staff, or quote" aria-label="Search leads" className="h-10 min-w-[240px] flex-1 rounded-md border border-sand-200 px-3 text-sm" />
        <LeadFilterDropdown label="Filter leads by status" allLabel="All except spam" value={filters.status} onChange={value => change("status", value)} options={FILTER_TABS.filter(item => item.value !== "all")} allValues={FILTER_TABS.filter(item => item.value !== "all" && item.value !== "spam").map(item => item.value)} />
        <LeadFilterDropdown label="Filter leads by source" allLabel="All sources" value={filters.source} onChange={value => change("source", value)} options={(["website", "meta", "outreach"] as const).filter(source => store === "rf_transparent" || source === "website").map(source => ({ value: source, label: SOURCE_BADGE[source].label, count: queue.filter(lead => lead.source === source && !isLeadSpamReason(lead.not_applicable_reason)).length }))} />
        <LeadFilterDropdown label="Filter leads by owner" allLabel="Everyone" value={filters.owner} onChange={value => change("owner", value)} options={[{ value: "mine", label: "My leads", disabled: !currentUserEmail }, { value: "unassigned", label: "Unassigned" }, { value: "others", label: "Other assigned leads" }]} />
        <select aria-label="Sort leads" value={filters.sort} onChange={(event) => change("sort", event.target.value)} className="h-10 rounded-md border border-sand-200 px-2 text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        <label className="text-xs text-sand-500">Received <select aria-label="Lead received date range" value={filters.history} onChange={(event) => change("history", event.target.value)} className="h-10 rounded-md border border-sand-200 px-2"><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></label>
        {filters.history !== "all" && <label className="flex items-center gap-2 text-xs text-sand-600"><input type="checkbox" checked={filters.olderOpen === "true"} onChange={(event) => change("olderOpen", String(event.target.checked))} />Include older open leads</label>}
        <button className="px-2 text-xs text-blue-700" onClick={() => setFilters({ status: "open", source: "all", owner: "all", search: "", sort: "newest", history: "30d", olderOpen: "false" })}>Reset</button>
      </div>
      {error && <div role="alert" className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>{data ? "The latest refresh failed. Showing the last loaded records." : "Lead data could not be loaded."}</span><button className="shrink-0 underline" onClick={() => void reload()}>Try again</button></div>}
      {isLoading && !data ? <p className="p-8 text-center text-sm text-sand-500">Loading leads...</p> : visible.length === 0 ? <p className="p-8 text-center text-sm text-sand-500">No leads match these filters.</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] table-fixed text-sm"><thead className="bg-sand-50 text-left text-[11px] uppercase tracking-wider text-sand-500"><tr><th className="w-[29%] px-4 py-3">Lead / contact</th><th className="w-[26%] px-3 py-3">Next action / owner</th><th className="w-[17%] px-3 py-3">Last call</th><th className="w-[17%] px-3 py-3">Latest quote</th><th className="w-[11%] px-3 py-3">Stage</th></tr></thead>
          <tbody>{visible.slice(0, count).map((lead) => <tr key={lead.id} onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button, input, select, textarea, summary, details")) setSelectedLeadId(lead.id); }} className="cursor-pointer border-t border-sand-100 align-top hover:bg-sand-50/50">
            <td className="px-4 py-3"><button onClick={() => setSelectedLeadId(lead.id)} className="text-left font-semibold text-sand-900 hover:text-blue-700"><span className="line-clamp-2 break-words">{lead.name || "Unnamed"}</span></button><div className="my-1 flex flex-wrap items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] ${SOURCE_BADGE[lead.source].className}`}>{SOURCE_BADGE[lead.source].label}</span><span className="text-[10px] text-sand-400" title={formatDateTime(lead.submitted_at)}>Received {formatDate(lead.submitted_at)}</span></div>
              {lead.email && <div className="flex items-start gap-2 text-xs"><a href={`mailto:${lead.email}`} className="break-all text-blue-700">{lead.email}</a><button aria-label={`Copy email for ${lead.name || lead.email}`} onClick={() => void copy(lead.email!, "Email")} className="shrink-0 text-[10px] text-sand-500">Copy</button></div>}
              {lead.phone && <div className="mt-1 flex items-center gap-2 text-xs"><a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`} className="text-blue-700">{lead.phone}</a><button aria-label={`Copy phone for ${lead.name || lead.phone}`} onClick={() => void copy(lead.phone!, "Phone")} className="text-[10px] text-sand-500">Copy</button></div>}
            </td>
            <td className="px-3 py-3"><div className="break-words text-xs text-sand-700">{isOpenLead(lead) ? lead.next_action || (hasUnansweredReply(lead) ? "Reply to prospect" : lead.call_status === "not_called" ? "Make first contact" : "Set the next action") : "Closed"}</div><div className={`mt-1 text-xs ${isFollowUpDue(lead, now) ? "font-medium text-amber-700" : "text-sand-500"}`}>{isOpenLead(lead) ? lead.next_follow_up_at ? `${isFollowUpDue(lead, now) ? "Due: " : "Follow up: "}${formatDateTime(lead.next_follow_up_at)}` : "No follow-up scheduled" : ""}</div><div className="mt-1 break-words text-xs text-sand-500">{lead.assigned_to || "Unassigned"}</div><button onClick={() => setSelectedLeadId(lead.id)} className="mt-1 text-xs text-blue-700">Assign / schedule</button></td>
            <td className="px-3 py-3"><span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${CALL_BADGE[lead.call_status]}`}>{needsPhone(lead) ? "No phone" : CALL_STATUS_LABELS[lead.call_status]}</span>{lead.last_call_at && <div className="mt-1 text-xs text-sand-600">{formatDateTime(lead.last_call_at)}<div className="break-words text-sand-400">{lead.last_called_by || "Staff not recorded"}</div></div>}<details className="mt-2 text-[10px] text-sand-500"><summary className="cursor-pointer">First response times</summary><div className="mt-1"><LeadResponseSummary lead={lead} /></div></details></td>
            <td className="px-3 py-3">{lead.quote_number ? <><span className="font-medium">{lead.quote_number}</span>{lead.quote_amount != null && <div className="text-xs text-sand-600">{formatCADWhole(Number(lead.quote_amount))}</div>}<div className="mt-1 text-[11px] text-sand-500">{lead.quote_sent_at ? `Sent ${formatDateTime(lead.quote_sent_at)}` : "Send date not recorded"}</div></> : <span className="text-xs text-sand-400">No quote recorded</span>}</td>
            <td className="px-3 py-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs ${OUTCOME_BADGE[lead.outcome]}`}>{OUTCOME_LABELS[lead.outcome] || "New"}</span></td>
          </tr>)}</tbody></table>{count < visible.length && <LoadMoreRows shown={count} total={visible.length} onLoadMore={showMore} />}
      </div>}
    </section>
    </div>
    </div>
    {copyMessage && <p role="status" className="text-xs text-sand-600">{copyMessage}</p>}
    {selected && <LeadDetailPanel key={selected.id} lead={selected} store={store} currentUserEmail={currentUserEmail} onClose={() => setSelectedLeadId(null)} onChanged={refresh} />}
  </div>;
}
