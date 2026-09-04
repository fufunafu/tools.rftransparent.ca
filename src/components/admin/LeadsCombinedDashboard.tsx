"use client";

// TEMPORARY combined Leads + Follow-up page (/customer-service/tmp).
// Real data: leads joined to their Shopify quotes by the API route at
// /api/customer-service/leads-combined. Actions reuse the existing Leads
// PATCH endpoint and the Follow-up POST actions, so anything done here shows
// up on the two original pages too.

import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import FollowUpModal from "@/components/admin/followup/FollowUpModal";
import { redirectOnUnauthorized } from "@/lib/client-auth";
import { formatLeadResponseTime } from "@/lib/lead-response-times";
import { LEAD_SPAM_REASON } from "@/lib/customer-service/lead-spam";
import { LEAD_STORE_COOKIE, LEAD_STORE_OPTIONS, leadStoreSlug, type LeadStoreId } from "@/lib/customer-service/lead-store";
import type { LeadCallAttempt, LeadSubmission } from "@/lib/customer-service/leads";
import type { FollowUpLead, FollowUpLog, LeadStatus } from "@/lib/followup";
import type {
  CombinedCallState,
  CombinedPayload,
  CombinedRow,
  CombinedSource,
  CombinedStage,
  CombinedTab,
} from "@/lib/customer-service/leads-combined";

// ─── Labels and styling ──────────────────────────────────────────────────────

const STAGE_LABELS: Record<CombinedStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  hot_lead: "Hot lead",
  considering: "Considering",
  price_shopping: "Price shopping",
  future_project: "Future project",
  no_answer: "No answer",
  won: "Won",
  lost: "Lost",
  not_applicable: "Not applicable",
  duplicate: "Duplicate",
};

const STAGE_CLASSES: Record<CombinedStage, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  quoted: "bg-indigo-100 text-indigo-700",
  hot_lead: "bg-red-100 text-red-700",
  considering: "bg-yellow-100 text-yellow-800",
  price_shopping: "bg-purple-100 text-purple-700",
  future_project: "bg-violet-100 text-violet-700",
  no_answer: "bg-white text-slate-600 border border-slate-300",
  won: "bg-green-100 text-green-700",
  lost: "bg-slate-100 text-slate-500",
  not_applicable: "bg-slate-100 text-slate-500",
  duplicate: "bg-fuchsia-100 text-fuchsia-700",
};

const CALL_LABELS: Record<CombinedCallState, string> = {
  called: "Called",
  not_called: "Not called",
  no_answer: "No answer",
  not_required: "Not required",
  no_phone: "No phone",
};

const CALL_CLASSES: Record<CombinedCallState, string> = {
  called: "bg-green-50 text-green-700 border-green-200",
  not_called: "bg-amber-50 text-amber-700 border-amber-200",
  no_answer: "bg-slate-50 text-slate-600 border-slate-300",
  not_required: "bg-slate-100 text-slate-500 border-slate-200",
  no_phone: "bg-red-50 text-red-700 border-red-200",
};

const NEXT_CLASSES: Record<CombinedRow["next"]["urgency"], string> = {
  now: "text-amber-700 font-semibold",
  today: "text-orange-700 font-semibold",
  overdue: "text-red-700 font-semibold",
  later: "text-slate-700 font-medium",
  none: "text-slate-400",
};

const TABS: { id: CombinedTab; label: string; hint: string }[] = [
  { id: "todo", label: "To do", hint: "Calls to make and follow-ups due, most urgent first." },
  { id: "upcoming", label: "Upcoming", hint: "Follow-ups scheduled for a later day." },
  { id: "addressed", label: "Addressed today", hint: "Anyone called or logged today." },
  { id: "awaiting", label: "Awaiting quote", hint: "Called, but no quote sent yet." },
  { id: "open", label: "Open quotes", hint: "Every quote still waiting on a decision." },
  { id: "closed", label: "Closed", hint: "Won, lost, not applicable, duplicate." },
  { id: "all", label: "All", hint: "Everything from the last 12 months except spam." },
  { id: "dupes", label: "Duplicates", hint: "One person with more than one open quote." },
];

const SOURCE_LABELS: Record<CombinedSource, string> = { website: "Website", meta: "Meta", quote: "Quote only" };
const SOURCE_DOT: Record<CombinedSource, string> = {
  website: "bg-blue-500",
  meta: "bg-pink-700",
  quote: "border border-slate-400",
};

const LEAD_OUTCOMES: { value: "new" | "contacted" | "quoted" | "won" | "lost" | "not_applicable"; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "quoted", label: "Quoted" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "not_applicable", label: "Not applicable" },
];

const QUOTE_STATUS_LABELS: Record<string, string> = {
  new: "Quoted",
  hot_lead: "Hot lead",
  considering: "Considering",
  price_shopping: "Price shopping",
  future_project: "Future project",
  no_answer: "No answer",
  won: "Won",
  lost: "Lost",
  duplicate: "Duplicate",
  not_duplicate: "Not a duplicate",
};

type SortKey = "urgent" | "newest" | "oldest" | "amount";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetcher<T>(url: string): Promise<T> {
  const response = redirectOnUnauthorized(await fetch(url));
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function money(value: number | string | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function compactMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(1)}k`;
  return money(value);
}

function percent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function shopifyDraftUrl(quote: FollowUpLead, shops: CombinedPayload["shops"]): string | null {
  const shop = shops.find((candidate) => candidate.id === quote.store_id);
  if (!shop) return null;
  const numericId = quote.shopify_draft_id.split("/").pop() ?? quote.shopify_draft_id;
  return `https://${shop.domain}/admin/draft_orders/${numericId}`;
}

function matchesSearch(row: CombinedRow, query: string): boolean {
  if (!query) return true;
  const haystack = [
    row.name,
    row.email,
    row.phone,
    row.staff,
    ...row.quotes.map((quote) => quote.draft_name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sortRows(rows: CombinedRow[], sort: SortKey): CombinedRow[] {
  if (sort === "urgent") return rows; // the API already orders by urgency
  const copy = [...rows];
  if (sort === "newest") copy.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (sort === "oldest") copy.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (sort === "amount") {
    copy.sort(
      (a, b) => (Number(b.primaryQuote?.quote_amount) || 0) - (Number(a.primaryQuote?.quote_amount) || 0),
    );
  }
  return copy;
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function StagePill({ stage }: { stage: CombinedStage }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_CLASSES[stage]}`}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

function CallChip({ state }: { state: CombinedCallState }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${CALL_CLASSES[state]}`}>
      {CALL_LABELS[state]}
    </span>
  );
}

function SourceDot({ source }: { source: CombinedSource }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-sm ${SOURCE_DOT[source]}`} title={SOURCE_LABELS[source]} />;
}

function Kpi({
  label,
  value,
  sub,
  alert,
  website,
  meta,
  dot,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
  website?: string;
  meta?: string;
  dot: string;
}) {
  return (
    <div className={`min-w-0 rounded-xl border p-3.5 ${alert ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
      <div className="flex min-h-[26px] flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 whitespace-nowrap text-[21px] font-bold leading-tight tracking-tight text-slate-900">{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{sub}</div>
      {website !== undefined && meta !== undefined && (
        <div className="mt-2.5 space-y-0.5 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
          <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
            <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm bg-blue-500 align-middle" />Website</span>
            <b className="text-[12.5px] text-slate-900">{website}</b>
          </div>
          <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
            <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-sm bg-pink-700 align-middle" />Meta</span>
            <b className="text-[12.5px] text-slate-900">{meta}</b>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

interface DrawerProps {
  row: CombinedRow;
  storeId: LeadStoreId;
  shops: CombinedPayload["shops"];
  nowMs: number;
  onClose: () => void;
  onMutated: () => void;
  onLogFollowUp: (quote: FollowUpLead) => void;
}

function RowDrawer({ row, storeId, shops, nowMs, onClose, onMutated, onLogFollowUp }: DrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lead = row.lead;
  const primary = row.primaryQuote;
  const closed = ["won", "lost", "not_applicable", "duplicate"].includes(row.stage);

  const attemptsUrl = lead
    ? `/api/customer-service/leads?view=call_attempts&lead_ids=${encodeURIComponent(lead.ids.join(","))}&since=${encodeURIComponent(lead.submitted_at)}`
    : null;
  const detailsUrl = lead ? `/api/customer-service/leads?view=details&lead_id=${encodeURIComponent(lead.id)}` : null;
  const logsUrl = primary
    ? `/api/customer-service/follow-up?view=logs&store=${encodeURIComponent(primary.store_id)}&lead_id=${encodeURIComponent(primary.id)}`
    : null;

  const { data: attemptsData } = useSWR<{ attempts: LeadCallAttempt[] }>(attemptsUrl, fetcher);
  const { data: detailsData } = useSWR<{ details: LeadSubmission[] }>(detailsUrl, fetcher);
  const { data: logsData, mutate: mutateLogs } = useSWR<{ logs: FollowUpLog[] }>(logsUrl, fetcher);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patchLead(fields: Record<string, unknown>): Promise<boolean> {
    if (!lead) return false;
    setBusy(true);
    setError(null);
    try {
      const response = redirectOnUnauthorized(
        await fetch("/api/customer-service/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: lead.ids, ...fields }),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${response.status})`);
      }
      onMutated();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function requote(quote: FollowUpLead) {
    if (!window.confirm(`Reset follow-ups on ${quote.draft_name} and start the cadence again?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = redirectOnUnauthorized(
        await fetch(`/api/customer-service/follow-up?store=${encodeURIComponent(quote.store_id)}&action=requote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: quote.id }),
        }),
      );
      const json = (await response.json()) as { status?: string; error?: string };
      if (json.status !== "success") throw new Error(json.error ?? "Re-quote failed");
      onMutated();
      void mutateLogs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const otherStore = storeId === "bc_transparent" ? "rf_transparent" : "bc_transparent";
  const otherStoreLabel = LEAD_STORE_OPTIONS.find((option) => option.id === otherStore)?.label ?? otherStore;
  const kind = row.source === "website" ? "Website lead" : row.source === "meta" ? "Meta lead" : "Quote only";
  const submissions = detailsData?.details ?? [];
  const attempts = attemptsData?.attempts ?? [];
  const logs = logsData?.logs ?? [];
  const otherQuotes = row.quotes.filter((quote) => quote.id !== primary?.id);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[600px] flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 pb-4 pt-5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{kind}</div>
          <h3 className="mt-1 text-2xl font-bold text-slate-900">{row.name}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StagePill stage={row.stage} />
            <CallChip state={row.callState} />
            {lead && lead.duplicate_count > 1 && (
              <span className="rounded-full bg-fuchsia-100 px-2.5 py-0.5 text-xs font-semibold text-fuchsia-700">
                {lead.duplicate_count} submissions combined
              </span>
            )}
            {row.attempts > 0 && (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {row.attempts} follow-up{row.attempts === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 text-2xl leading-none text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 border-b border-slate-200 px-6 py-4">
          {row.phone ? (
            <a href={`tel:${row.phone}`} className="rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-700">
              Call {row.phone}
            </a>
          ) : (
            <span className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-center text-sm font-medium text-slate-400">No phone on file</span>
          )}
          {row.email ? (
            <a href={`mailto:${row.email}`} className="rounded-lg border border-slate-200 px-4 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Email
            </a>
          ) : (
            <span className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-center text-sm font-medium text-slate-400">No email on file</span>
          )}
        </div>

        {error && (
          <p role="alert" className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        {/* Submissions */}
        <section className="border-b border-slate-200 px-6 py-4">
          <h4 className="mb-3 flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {lead ? "Submissions" : "Customer"}
            <span className="ml-auto text-xs font-medium normal-case tracking-normal text-slate-500">
              {lead ? `${lead.duplicate_count} submission${lead.duplicate_count === 1 ? "" : "s"}` : "No form submission"}
            </span>
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">{lead ? "First submitted" : "Quote created"}</div>
              <div className="font-semibold">{formatDateTime(row.receivedAt)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Staff</div>
              <div className="font-semibold">{row.staff || "Unassigned"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Time to first call</div>
              <div className="font-semibold">
                {row.callState === "not_required" ? "Not required" : row.timeToCallMs != null ? formatLeadResponseTime(row.timeToCallMs) : "Not called yet"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Time to first quote</div>
              <div className="font-semibold">
                {row.timeToQuoteMs != null ? formatLeadResponseTime(row.timeToQuoteMs) : row.quotes.length ? "—" : "Not quoted yet"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Email</div>
              <div className="truncate font-medium text-blue-600">{row.email ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Phone</div>
              <div className="font-medium text-blue-600">{row.phone ?? "—"}</div>
            </div>
          </div>
          {lead && submissions.length === 0 && lead.message && (
            <div className="mt-2.5 rounded-xl border border-slate-200 p-3.5 text-sm text-slate-700">{lead.message}</div>
          )}
          {submissions.map((submission) => (
            <div key={submission.id} className="mt-2.5 rounded-xl border border-slate-200 p-3.5">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <SourceDot source={submission.source} />
                <b className="text-[13px] text-slate-900">{submission.source_detail || SOURCE_LABELS[submission.source]}</b>
                {submission.page_url && <span className="truncate">· {submission.page_url.replace(/^https?:\/\//, "")}</span>}
                <span className="ml-auto whitespace-nowrap">{formatDateTime(submission.submitted_at)}</span>
              </div>
              {submission.message && <div className="text-sm text-slate-700">{submission.message}</div>}
              {submission.attachments && submission.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {submission.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={`/api/customer-service/leads/attachments/${attachment.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      📎 {attachment.filename}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!lead && (
            <p className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-500">
              This customer came in without a website or Meta form. The row was created from the quote and is excluded from inquiry statistics.
            </p>
          )}
        </section>

        {/* Call activity */}
        <section className="border-b border-slate-200 px-6 py-4">
          <h4 className="mb-3 flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Call activity
            <span className="ml-auto text-xs font-medium normal-case tracking-normal text-slate-500">
              {attempts.length} call{attempts.length === 1 ? "" : "s"}
            </span>
          </h4>
          {attempts.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <b className="block text-sm">{lead ? "No calls linked to this lead" : "No call tracking for quote-only customers"}</b>
              <small className="text-xs text-slate-500">
                {lead ? "Automatic phone matching has not found a call after this submission." : "Calls are matched to form submissions only."}
              </small>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
              {attempts.map((attempt) => (
                <div key={attempt.id} className="flex items-start gap-3 px-3.5 py-3">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${attempt.result === "called" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {attempt.result === "called" ? "✓" : "–"}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {attempt.result === "called" ? "Answered" : "No answer"}
                      <span className="rounded border border-green-200 bg-green-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">Auto</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(attempt.called_at)} · {attempt.staff}
                      {attempt.notes ? ` · ${attempt.notes}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Quote */}
        <section className="border-b border-slate-200 px-6 py-4">
          <h4 className="mb-3 flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Quote
            {primary && shopifyDraftUrl(primary, shops) && (
              <a href={shopifyDraftUrl(primary, shops) ?? "#"} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium normal-case tracking-normal text-blue-600 hover:underline">
                View in Shopify ↗
              </a>
            )}
          </h4>
          {primary ? (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-baseline gap-2.5">
                <b className="text-base">{primary.draft_name}</b>
                <span className="text-sm text-slate-700">{money(primary.quote_amount)}</span>
                <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-slate-500">{primary.shopify_status.replace("_", " ")}</span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5 text-xs">
                <div>
                  <div className="text-slate-500">Sent</div>
                  <div className="font-semibold">{primary.shopify_created_at ? formatDate(primary.shopify_created_at) : "—"}</div>
                </div>
                <div>
                  <div className="text-slate-500">Staff</div>
                  <div className="truncate font-semibold">{primary.last_invoice_sender || primary.created_by_staff || "—"}</div>
                </div>
                <div>
                  <div className="text-slate-500">Next follow-up</div>
                  <div className={`font-semibold ${NEXT_CLASSES[row.next.urgency]}`}>
                    {row.next.kind === "followup" || row.next.kind === "resolve" ? row.next.label : "—"}
                  </div>
                </div>
              </div>
              {primary.close_reason && (
                <div className="mt-2 text-xs text-slate-500">Close reason: <b className="text-slate-700">{primary.close_reason}</b></div>
              )}
              {!closed && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => onLogFollowUp(primary)} disabled={busy} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    Log Follow-up
                  </button>
                  <button onClick={() => void requote(primary)} disabled={busy} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    ↻ Re-Quote
                  </button>
                </div>
              )}
              {closed && row.stage === "lost" && (
                <div className="mt-3">
                  <button onClick={() => void requote(primary)} disabled={busy} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    ↻ Re-Quote (reopen)
                  </button>
                </div>
              )}
              {otherQuotes.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-2.5 text-xs text-slate-500">
                  Other quotes:{" "}
                  {otherQuotes.map((quote) => (
                    <span key={quote.id} className="mr-2 whitespace-nowrap">
                      <b className="text-slate-700">{quote.draft_name}</b> {money(quote.quote_amount)} · {QUOTE_STATUS_LABELS[quote.lead_status] ?? quote.lead_status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <b className="block text-sm">{lead?.quote_number ? `Quote ${lead.quote_number} is not in the follow-up list` : "No quote sent yet"}</b>
              <small className="text-xs text-slate-500">
                {lead?.quote_number
                  ? "It is older than a year or still an unsent draft, so there is nothing to follow up on here."
                  : "The hourly sync links a Shopify draft order automatically when the email or phone matches."}
              </small>
            </div>
          )}
        </section>

        {/* Follow-up history */}
        <section className="border-b border-slate-200 px-6 py-4">
          <h4 className="mb-3 flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Follow-up history
            <span className="ml-auto text-xs font-medium normal-case tracking-normal text-slate-500">{logs.length} logged</span>
          </h4>
          {logs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <b className="block text-sm">No follow-ups logged yet</b>
              <small className="text-xs text-slate-500">{primary ? "Use Log Follow-up above after each attempt." : "Follow-ups start once a quote is sent."}</small>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
              {logs.map((log, index) => (
                <div key={log.id} className="flex items-start gap-3 px-3.5 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-rose-50 text-xs font-bold text-rose-800">{logs.length - index}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {QUOTE_STATUS_LABELS[log.outcome] ?? log.outcome}
                      {log.logged_by === "system" && (
                        <span className="rounded border border-green-200 bg-green-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">Auto</span>
                      )}
                    </div>
                    {log.notes && <div className="mt-0.5 text-sm text-slate-700">{log.notes}</div>}
                    <div className="text-xs text-slate-500">{formatDateTime(log.created_at)} · {log.logged_by}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Outcome */}
        <section className="px-6 py-4">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Outcome</h4>
          {lead ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {lead.call_status !== "called" && lead.outcome !== "not_applicable" && (
                  <button
                    disabled={busy}
                    onClick={() => void patchLead({ call_status: "called", ...(lead.outcome === "new" ? { outcome: "contacted" } : {}) })}
                    className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                  >
                    Mark as called
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (await patchLead({ store_id: otherStore })) onClose();
                  }}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  Send to {otherStoreLabel}
                </button>
                {lead.isSpam ? (
                  <button
                    disabled={busy}
                    onClick={() => void patchLead({ outcome: "new", not_applicable_reason: null })}
                    className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Restore from spam
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => void patchLead({ outcome: "not_applicable", not_applicable_reason: LEAD_SPAM_REASON })}
                    className="ml-auto rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    Mark as spam
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {LEAD_OUTCOMES.map((option) => (
                  <button
                    key={option.value}
                    disabled={busy}
                    onClick={() => void patchLead({ outcome: option.value })}
                    className={`rounded-lg border px-2 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                      lead.outcome === option.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {primary && !closed && (
                <p className="mt-2 text-xs text-slate-500">
                  Anything the customer said about the quote (hot lead, considering, price shopping, future project, no answer, lost) goes through <b>Log Follow-up</b> above so the next date gets scheduled.
                </p>
              )}
              {(lead.not_applicable_reason || lead.lost_reason) && (
                <p className="mt-2 text-xs text-slate-500">Reason: {lead.not_applicable_reason ?? lead.lost_reason}</p>
              )}
              <textarea
                key={`${lead.id}:${lead.notes ?? ""}`}
                defaultValue={lead.notes ?? ""}
                placeholder="Internal notes"
                disabled={busy}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (lead.notes ?? "")) void patchLead({ notes: value || null });
                }}
                className="mt-3 min-h-[72px] w-full rounded-lg border border-slate-200 p-3 text-sm"
              />
            </>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
              Quote-only customers are worked through <b>Log Follow-up</b> and <b>Re-Quote</b> above. Marking them won happens automatically when the order is placed.
            </p>
          )}
          <p className="mt-4 text-[11px] text-slate-400">Last refreshed {timeAgo(new Date(nowMs).toISOString(), nowMs)} · changes appear on the Leads and Follow-up pages too.</p>
        </section>
      </aside>
    </>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function LeadsCombinedDashboard({ initialStore }: { initialStore: LeadStoreId }) {
  const [store, setStore] = useState<LeadStoreId>(initialStore);
  const [tab, setTab] = useState<CombinedTab>("todo");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<CombinedStage | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<CombinedSource | "all">("all");
  const [sort, setSort] = useState<SortKey>("urgent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalQuote, setModalQuote] = useState<FollowUpLead | null>(null);
  const { mutate } = useSWRConfig();

  const payloadUrl = `/api/customer-service/leads-combined?store=${leadStoreSlug(store)}`;
  const { data, error, isLoading, isValidating } = useSWR<CombinedPayload>(payloadUrl, fetcher, {
    refreshInterval: 60_000,
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
  const configUrl = modalQuote ? `/api/customer-service/follow-up?view=config&store=${encodeURIComponent(modalQuote.store_id)}` : null;
  const { data: configData } = useSWR<{ config: Record<string, number | null> }>(configUrl, fetcher);

  const nowMs = data ? new Date(data.generatedAt).getTime() : 0;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        row.tabs.includes(tab) &&
        (stageFilter === "all" || row.stage === stageFilter) &&
        (sourceFilter === "all" || row.source === sourceFilter) &&
        matchesSearch(row, query),
    );
    return sortRows(filtered, sort);
  }, [rows, tab, stageFilter, sourceFilter, search, sort]);
  const selected = selectedId ? rows.find((row) => row.id === selectedId) ?? null : null;
  const summary = data?.summary;
  const stageCounts = useMemo(() => {
    const counts = new Map<CombinedStage, number>();
    for (const row of rows) if (row.tabs.length) counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
    return counts;
  }, [rows]);

  // Remember the choice the same way the Leads and Phones pages do, so the
  // three pages open on the same store.
  function changeStore(next: LeadStoreId) {
    setStore(next);
    setSelectedId(null);
    try {
      window.localStorage.setItem(LEAD_STORE_COOKIE, next);
      document.cookie = `${LEAD_STORE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Storage failures only lose the memory of the choice.
    }
  }

  async function submitFollowUp(payload: { lead_id: string; outcome: LeadStatus; notes?: string; close_reason?: string; custom_date?: string }) {
    if (!modalQuote) return;
    const response = redirectOnUnauthorized(
      await fetch(`/api/customer-service/follow-up?store=${encodeURIComponent(modalQuote.store_id)}&action=log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const json = (await response.json()) as { status?: string; error?: string };
    if (json.status !== "success") throw new Error(json.error ?? "Could not log the follow-up");
    setModalQuote(null);
    void mutate(payloadUrl);
    void mutate(
      `/api/customer-service/follow-up?view=logs&store=${encodeURIComponent(modalQuote.store_id)}&lead_id=${encodeURIComponent(modalQuote.id)}`,
    );
  }

  const activeTab = TABS.find((candidate) => candidate.id === tab) ?? TABS[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500">Track, contact, quote, and follow up on website and Meta leads.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <select
            value={store}
            onChange={(event) => changeStore(event.target.value as LeadStoreId)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            aria-label="Store"
          >
            {LEAD_STORE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${isValidating ? "bg-amber-400" : "bg-emerald-500"}`} />
            {data ? `Refreshed ${timeAgo(data.generatedAt, nowMs)} · updates every minute` : "Loading…"}
          </span>
          <a href={`/customer-service/leads/${leadStoreSlug(store)}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Leads page
          </a>
          <a href="/customer-service/follow-up" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Follow-up page
          </a>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load: {error.message}
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Need a call"
          dot="bg-amber-500"
          alert={(summary?.needCall.total ?? 0) > 0}
          value={summary ? String(summary.needCall.total) : "…"}
          sub={summary ? (summary.needCall.over24h ? `${summary.needCall.over24h} waiting over 24 hours` : "No overdue calls") : ""}
          website={summary ? String(summary.needCall.split.website) : undefined}
          meta={summary ? String(summary.needCall.split.meta) : undefined}
        />
        <Kpi
          label="Follow-ups due"
          dot="bg-orange-600"
          alert={(summary?.followupsDue.total ?? 0) > 0}
          value={summary ? String(summary.followupsDue.total) : "…"}
          sub={summary ? (summary.followupsDue.overdue ? `${summary.followupsDue.overdue} overdue` : "Nothing overdue") : ""}
          website={summary ? String(summary.followupsDue.split.website) : undefined}
          meta={summary ? String(summary.followupsDue.split.meta) : undefined}
        />
        <Kpi
          label="New leads · 30 days"
          dot="bg-blue-500"
          value={summary ? String(summary.newLeads30d.total) : "…"}
          sub={summary ? `Median call ${formatLeadResponseTime(summary.medianCallMs)} · quote ${formatLeadResponseTime(summary.medianQuoteMs)}` : ""}
          website={summary ? String(summary.newLeads30d.split.website) : undefined}
          meta={summary ? String(summary.newLeads30d.split.meta) : undefined}
        />
        <Kpi
          label="Quoted pipeline"
          dot="bg-indigo-600"
          value={summary ? money(summary.openQuotes.amount) : "…"}
          sub={summary ? `${summary.openQuotes.count} open quotes · 12 months` : ""}
          website={summary ? compactMoney(summary.openQuotes.split.website) : undefined}
          meta={summary ? compactMoney(summary.openQuotes.split.meta) : undefined}
        />
        <Kpi
          label="Conversion"
          dot="bg-green-600"
          value={summary ? percent(summary.conversion.rate) : "…"}
          sub={summary ? `${summary.conversion.won} won / ${summary.conversion.won + summary.conversion.lost} closed · 12 months` : ""}
        />
        <Kpi
          label="Attempts per quote"
          dot="bg-slate-400"
          value={summary && summary.attempts.average != null ? summary.attempts.average.toFixed(1) : "…"}
          sub={summary ? `${summary.attempts.quotes} quotes · ${summary.spam} spam hidden` : ""}
        />
      </div>

      {/* Queue */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline gap-3 px-4 pb-3 pt-4">
          <h2 className="text-[15px] font-semibold text-slate-900">Lead queue</h2>
          <span className="text-xs text-slate-500">
            {data ? `${visible.length} of ${data.counts.all} · ${activeTab.hint}` : "Loading…"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
          {TABS.map((candidate) => {
            const active = candidate.id === tab;
            return (
              <button
                key={candidate.id}
                onClick={() => setTab(candidate.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  active ? "border-blue-200 bg-blue-100 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {candidate.label}
                <span className={`text-[11px] ${active ? "font-semibold text-blue-700" : "text-slate-500"}`}>{data?.counts[candidate.id] ?? "–"}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-y border-slate-200 bg-slate-50/70 px-3.5 py-3 md:grid-cols-[minmax(200px,1.6fr)_repeat(3,minmax(120px,0.8fr))]">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, phone, quote #, or staff"
            className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-1"
          />
          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as CombinedStage | "all")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" aria-label="Stage">
            <option value="all">All stages ({data?.counts.all ?? 0})</option>
            {(Object.keys(STAGE_LABELS) as CombinedStage[]).map((stage) => (
              <option key={stage} value={stage}>{STAGE_LABELS[stage]} ({stageCounts.get(stage) ?? 0})</option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as CombinedSource | "all")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" aria-label="Source">
            <option value="all">All sources</option>
            <option value="website">Website</option>
            <option value="meta">Meta</option>
            <option value="quote">Quote only</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" aria-label="Sort">
            <option value="urgent">Most urgent</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount">Largest quote</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3.5 py-3">Lead</th>
                <th className="px-3.5 py-3">Received</th>
                <th className="px-3.5 py-3">Response</th>
                <th className="px-3.5 py-3">Contact</th>
                <th className="px-3.5 py-3">Quote / Staff</th>
                <th className="px-3.5 py-3">Stage</th>
                <th className="px-3.5 py-3">Next</th>
                <th className="px-3.5 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && !data && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">Loading leads and quotes…</td></tr>
              )}
              {data && visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">Nothing here right now.</td></tr>
              )}
              {visible.map((row) => {
                const stripe = row.next.urgency === "overdue" ? "shadow-[inset_3px_0_0_#dc2626]" : row.next.urgency === "now" || row.next.urgency === "today" ? "shadow-[inset_3px_0_0_#d97706]" : "";
                const quote = row.primaryQuote;
                return (
                  <tr key={row.id} onClick={() => setSelectedId(row.id)} className="cursor-pointer border-t border-slate-200 hover:bg-slate-50">
                    <td className={`px-3.5 py-3 ${stripe}`}>
                      <div className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-slate-900">
                        <SourceDot source={row.source} />
                        {row.name}
                      </div>
                      <div className="max-w-[210px] truncate text-xs text-slate-500">
                        {row.email ?? ""}{row.email && row.phone ? " · " : ""}{row.phone ?? (row.email ? "" : "no contact")}
                      </div>
                      {row.lead && row.lead.duplicate_count > 1 && (
                        <div className="text-[11px] text-slate-500">{row.lead.duplicate_count} submissions combined</div>
                      )}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div>{formatDate(row.receivedAt)}</div>
                      <div className="text-xs text-slate-500">{timeAgo(row.receivedAt, nowMs)}</div>
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="grid grid-cols-[auto_auto] gap-x-2.5 gap-y-0.5 text-xs">
                        <span className="text-slate-500">Call</span>
                        <span className={row.timeToCallMs != null ? "font-semibold text-slate-900" : "text-slate-500"}>
                          {row.callState === "not_required" ? "Not required" : row.timeToCallMs != null ? formatLeadResponseTime(row.timeToCallMs) : "Pending"}
                        </span>
                        <span className="text-slate-500">Quote</span>
                        <span className={row.timeToQuoteMs != null ? "font-semibold text-slate-900" : "text-slate-500"}>
                          {row.kind === "quote" ? "—" : row.timeToQuoteMs != null ? formatLeadResponseTime(row.timeToQuoteMs) : "Pending"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3.5 py-3">
                      <CallChip state={row.callState} />
                      {row.lead?.last_called_by && (
                        <div className="mt-0.5 max-w-[170px] truncate text-xs text-slate-500">{row.lead.last_called_by}</div>
                      )}
                      {row.kind === "quote" && <div className="mt-0.5 text-xs text-slate-500">Walk-in / phone / email</div>}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      {quote ? (
                        <>
                          <div className="font-semibold">{quote.draft_name}{row.quotes.length > 1 ? ` +${row.quotes.length - 1}` : ""}</div>
                          <div className="text-xs text-slate-500">{money(quote.quote_amount)}</div>
                        </>
                      ) : row.lead?.quote_number ? (
                        <>
                          <div className="font-semibold">{row.lead.quote_number}</div>
                          <div className="text-xs text-slate-500">{row.lead.quote_amount != null ? money(row.lead.quote_amount) : "not tracked"}</div>
                        </>
                      ) : (
                        <div className="text-slate-400">–</div>
                      )}
                      <div className="text-xs text-slate-500">Staff: {row.staff || "Unassigned"}</div>
                    </td>
                    <td className="px-3.5 py-3"><StagePill stage={row.stage} /></td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <span className={NEXT_CLASSES[row.next.urgency]}>{row.next.label}</span>
                      {quote && <div className="text-xs text-slate-500">{row.attempts} attempt{row.attempts === 1 ? "" : "s"}</div>}
                    </td>
                    <td className="px-3.5 py-3 text-right"><span className="text-[13px] font-medium text-blue-600">View</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && data && (
        <RowDrawer
          row={selected}
          storeId={store}
          shops={data.shops}
          nowMs={nowMs}
          onClose={() => setSelectedId(null)}
          onMutated={() => void mutate(payloadUrl)}
          onLogFollowUp={(quote) => setModalQuote(quote)}
        />
      )}

      {modalQuote && (
        <FollowUpModal
          lead={modalQuote}
          storeDays={configData?.config}
          onClose={() => setModalQuote(null)}
          onSubmit={submitFollowUp}
        />
      )}
    </div>
  );
}
