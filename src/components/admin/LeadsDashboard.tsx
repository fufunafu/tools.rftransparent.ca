"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { CallStatus, Lead, LeadCallAttempt, LeadSource, Outcome } from "@/lib/customer-service/leads";
import { OUTCOME_LABELS, CALL_STATUS_LABELS } from "@/lib/customer-service/leads";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

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

const SOURCE_BADGE: Record<LeadSource, { label: string; className: string }> = {
  website: { label: "Website", className: "bg-blue-100 text-blue-700" },
  meta: { label: "Meta", className: "bg-purple-100 text-purple-700" },
};

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─── Lead detail panel ───────────────────────────────────────────────────────

function LeadDetailPanel({
  lead,
  onClose,
  onChanged,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: attemptsData } = useSWR<{ attempts: LeadCallAttempt[] }>(
    `/api/customer-service/leads?view=call_attempts&lead_id=${lead.id}`,
    fetcher
  );
  const attempts = attemptsData?.attempts ?? [];

  const [logging, setLogging] = useState(false);
  const [callResult, setCallResult] = useState("");
  const [callNotes, setCallNotes] = useState("");

  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState(lead.quote_number ?? "");
  const [quoteAmount, setQuoteAmount] = useState(lead.quote_amount?.toString() ?? "");

  const handleLogCall = async () => {
    if (!callResult.trim()) return;
    setLogging(true);
    try {
      await fetch("/api/customer-service/leads?action=log_call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, result: callResult.trim(), notes: callNotes.trim() || undefined }),
      });
      setCallResult("");
      setCallNotes("");
      onChanged();
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
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-sand-200/60 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-lg font-semibold text-sand-900">{lead.name || "Unnamed lead"}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[lead.source].className}`}>
                {SOURCE_BADGE[lead.source].label}
              </span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${OUTCOME_BADGE[lead.outcome]}`}>
                {OUTCOME_LABELS[lead.outcome]}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-sand-400 hover:text-sand-600 p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Submission */}
        <div className="px-6 py-5 border-b border-sand-200/60 space-y-3">
          <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Submission</h4>
          <div className="space-y-1.5 text-sm">
            {lead.source_detail && (
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Source</span>
                <span className="text-sand-700 text-right truncate max-w-[240px]">{lead.source_detail}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-sand-500">Submitted</span>
              <span className="text-sand-700">{formatDateTime(lead.submitted_at)}</span>
            </div>
            {lead.email && (
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Email</span>
                <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">{lead.email}</a>
              </div>
            )}
            {lead.phone && (
              <div className="flex justify-between gap-3">
                <span className="text-sand-500">Phone</span>
                <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">{lead.phone}</a>
              </div>
            )}
          </div>
          {lead.message && (
            <div className="rounded-lg bg-sand-50 border border-sand-200/60 p-3 text-sm text-sand-700 whitespace-pre-wrap">
              {lead.message}
            </div>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-sand-400 hover:text-sand-600">Raw submission</summary>
            <pre className="mt-2 p-2 rounded bg-sand-50 border border-sand-200/60 overflow-x-auto text-[11px] text-sand-600">{JSON.stringify(lead.raw_payload, null, 2)}</pre>
          </details>
        </div>

        {/* Call log */}
        <div className="px-6 py-5 border-b border-sand-200/60 space-y-3">
          <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Call Log</h4>
          {attempts.length === 0 ? (
            <p className="text-sm text-sand-400">No calls logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {attempts.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-sand-100 flex items-center justify-center text-xs font-medium text-sand-600 shrink-0 uppercase">
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

          <div className="rounded-lg border border-sand-200 p-3 space-y-2">
            <input
              type="text"
              value={callResult}
              onChange={(e) => setCallResult(e.target.value)}
              placeholder="Call result (e.g. Spoke — interested)"
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text"
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full px-3 py-1.5 text-sm border border-sand-200 rounded bg-white text-sand-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleLogCall}
              disabled={logging || !callResult.trim()}
              className="w-full px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {logging ? "Logging..." : "+ Log Call"}
            </button>
          </div>
        </div>

        {/* Quote */}
        <div className="px-6 py-5 border-b border-sand-200/60 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quote</h4>
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
            <div className="rounded-lg bg-sand-50 border border-sand-200/60 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-sand-500">Quote #</span>
                <span className="font-medium text-sand-900">{lead.quote_number}</span>
              </div>
              {lead.quote_amount != null && (
                <div className="flex justify-between">
                  <span className="text-sand-500">Amount</span>
                  <span className="font-medium text-sand-900">{formatCurrency(Number(lead.quote_amount))}</span>
                </div>
              )}
              {lead.quote_sent_at && (
                <div className="flex justify-between">
                  <span className="text-sand-500">Sent</span>
                  <span className="text-sand-700">{formatDateTime(lead.quote_sent_at)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-sand-400">No quote sent yet.</p>
          )}
        </div>

        {/* Outcome */}
        <div className="px-6 py-5 space-y-3">
          <h4 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Outcome</h4>
          <div className="grid grid-cols-2 gap-2">
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
        </div>
      </div>
    </div>
  );
}

// ─── Setup banner ────────────────────────────────────────────────────────────

function SetupBanner({ count }: { count: number }) {
  const [open, setOpen] = useState(count === 0);

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-sand-50"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${count > 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              {count > 0 ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              )}
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-sand-900">
              {count > 0 ? `Website connected — ${count} lead${count === 1 ? "" : "s"} received` : "Website not connected yet"}
            </p>
            <p className="text-xs text-sand-500">
              {count > 0 ? "Click for setup instructions" : "Paste a small script into Powerful Form Builder to start receiving submissions"}
            </p>
          </div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-sand-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-sand-200/60 px-4 py-4 space-y-4 text-sm">
          <ol className="list-decimal list-inside space-y-2 text-sand-700">
            <li>In Shopify, open <strong>Powerful Form Builder → Forms</strong> and edit the form you want to track.</li>
            <li>Go to <strong>Settings</strong> and check <strong>“After form loaded, run this script”</strong> (not the &ldquo;After form submitted&rdquo; one — that runs after the form clears).</li>
            <li>Paste the snippet below into the script box.</li>
            <li>
              Replace <code className="px-1 py-0.5 bg-sand-100 rounded">YOUR_SECRET</code> with the value of the{" "}
              <code className="px-1 py-0.5 bg-sand-100 rounded">LEADS_WEBHOOK_SECRET</code> env var (set in Vercel).
            </li>
            <li>Save the form. Submit a test entry from your live site — it should appear here within seconds.</li>
            <li>Repeat for each form you want to capture leads from.</li>
          </ol>

          <div>
            <p className="text-xs font-medium text-sand-500 mb-1">Script to paste:</p>
            <pre className="p-3 rounded-lg bg-sand-900 text-sand-100 text-[11px] overflow-x-auto leading-relaxed">{INSTALL_SNIPPET}</pre>
          </div>

          <div className="text-xs text-sand-500">
            <p><strong>Why &ldquo;After form loaded&rdquo; instead of &ldquo;After form submitted&rdquo;?</strong> The after-submit hook runs after Powerful Form Builder clears the form, so by then we can&rsquo;t read the values. The after-loaded hook lets us register a submit listener and capture data at the right moment.</p>
          </div>
        </div>
      )}
    </div>
  );
}

const INSTALL_SNIPPET = `// Sends Powerful Form Builder submissions to the Leads dashboard.
// Paste this into Settings → "After form loaded, run this script".
(function () {
  // ─── EDIT FOR EACH FORM ─────────────────────────────────────────────
  // Map your Globo field names (what's inside {{...}} in the "Form inputs"
  // list) to the contact fields the dashboard cares about. Leave a value
  // as "" if your form doesn't have that field.
  var FIELD_MAP = {
    name:    "text",        // {{text}}
    email:   "email",       // {{email}}
    phone:   "phone-1",     // {{phone-1}}
    message: "textarea-1",  // {{textarea-1}}
  };
  // ────────────────────────────────────────────────────────────────────

  var WEBHOOK = "https://tools.rftransparent.ca/api/customer-service/leads/webhook?source=website&secret=YOUR_SECRET";

  document.querySelectorAll("form").forEach(function (form) {
    if (form.__rfHooked) return;
    form.__rfHooked = true;
    form.addEventListener("submit", function () {
      var fields = {};
      try {
        new FormData(form).forEach(function (v, k) { fields[k] = v; });
      } catch (e) {}

      var mapped = {};
      for (var key in FIELD_MAP) {
        var src = FIELD_MAP[key];
        if (src && fields[src]) mapped[key] = fields[src];
      }

      try {
        fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: fields,
            mapped: mapped,
            form_id: form.id || null,
            page_url: window.location.href,
            source_detail: document.title,
          }),
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    });
  });
})();`;

// ─── Main dashboard ──────────────────────────────────────────────────────────

export default function LeadsDashboard() {
  const [filter, setFilter] = useState<string>("uncalled");
  const [sourceFilter, setSourceFilter] = useState<"all" | LeadSource>("all");
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const { data, isLoading } = useSWR<{ leads: Lead[] }>(
    `/api/customer-service/leads${sourceFilter !== "all" ? `?source=${sourceFilter}` : ""}`,
    fetcher
  );
  const leads = data?.leads ?? [];
  const { mutate } = useSWRConfig();

  const refresh = () => {
    mutate((key) => typeof key === "string" && key.startsWith("/api/customer-service/leads"));
  };

  const filtered = useMemo(() => {
    const tab = FILTER_TABS.find((t) => t.value === filter) ?? FILTER_TABS[FILTER_TABS.length - 1];
    return leads.filter((l) => {
      if (!tab.match(l)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !(l.name ?? "").toLowerCase().includes(q) &&
          !(l.email ?? "").toLowerCase().includes(q) &&
          !(l.phone ?? "").includes(q)
        ) return false;
      }
      return true;
    });
  }, [leads, filter, search]);

  const filterCounts: Record<string, number> = useMemo(() => {
    const result: Record<string, number> = {};
    for (const tab of FILTER_TABS) {
      result[tab.value] = leads.filter((l) => tab.match(l)).length;
    }
    return result;
  }, [leads]);

  const metrics = useMemo(() => {
    const total = leads.length;
    const uncalled = leads.filter((l) => l.call_status === "not_called").length;
    const fromWebsite = leads.filter((l) => l.source === "website").length;
    const fromMeta = leads.filter((l) => l.source === "meta").length;
    const won = leads.filter((l) => l.outcome === "won").length;
    const lost = leads.filter((l) => l.outcome === "lost").length;
    const closed = won + lost;
    const conversion = closed > 0 ? Math.round((won / closed) * 100) : 0;
    const pipelineValue = leads
      .filter((l) => l.outcome === "quoted")
      .reduce((sum, l) => sum + Number(l.quote_amount ?? 0), 0);
    return { total, uncalled, fromWebsite, fromMeta, won, lost, conversion, pipelineValue };
  }, [leads]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-sand-900">Leads</h1>
          <p className="text-sm text-sand-500 mt-1">
            Form submissions from your website and Meta ads — call, quote, close.
          </p>
        </div>
      </div>

      {/* Setup banner */}
      <SetupBanner count={metrics.fromWebsite} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Uncalled"
          value={metrics.uncalled}
          color={metrics.uncalled > 0 ? "bg-amber-400" : "bg-sand-300"}
          subtitle={metrics.uncalled > 0 ? "Need a call" : "All caught up"}
        />
        <SummaryCard
          label="Total Leads"
          value={metrics.total}
          color="bg-blue-500"
          subtitle={`${metrics.fromWebsite} website · ${metrics.fromMeta} Meta`}
        />
        <SummaryCard
          label="Pipeline"
          value={formatCurrency(metrics.pipelineValue)}
          color="bg-indigo-500"
          subtitle={`${filterCounts.open_quote ?? 0} open quotes`}
        />
        <SummaryCard
          label="Conversion"
          value={`${metrics.conversion}%`}
          color="bg-green-500"
          subtitle={`${metrics.won} won / ${metrics.won + metrics.lost} closed`}
        />
      </div>

      {/* Source filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-sand-400 uppercase tracking-wider font-medium">Source</span>
        <div className="inline-flex rounded-lg border border-sand-200 bg-white p-0.5 text-xs font-medium">
          {(["all", "website", "meta"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 rounded-md transition-colors capitalize ${
                sourceFilter === s ? "bg-blue-600 text-white" : "text-sand-600 hover:text-sand-900"
              }`}
            >
              {s === "all" ? "All sources" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Lead table */}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-sand-200/60 px-4 pt-3 gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {FILTER_TABS.map((tab) => {
              const count = filterCounts[tab.value] ?? 0;
              const active = filter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                    active
                      ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
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
          <div className="pb-2 sm:pb-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone..."
              className="w-full sm:w-64 px-3 py-1.5 text-sm border border-sand-200 rounded-lg bg-sand-50 text-sand-700 placeholder-sand-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sand-400 text-sm">Loading leads…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sand-400 text-sm">
            {leads.length === 0
              ? "No leads yet. Paste the install script into Powerful Form Builder to start receiving submissions."
              : "No leads match this filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-200/60">
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Lead</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Source</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Submitted</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Call</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Quote</th>
                  <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Outcome</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className="border-b border-sand-100 hover:bg-sand-50/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-sand-900">{lead.name || "Unnamed"}</div>
                      <div className="text-[11px] text-sand-400 truncate max-w-[220px]">
                        {[lead.email, lead.phone].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[lead.source].className}`}>
                        {SOURCE_BADGE[lead.source].label}
                      </span>
                      {lead.source_detail && (
                        <div className="text-[11px] text-sand-400 mt-0.5 truncate max-w-[200px]">{lead.source_detail}</div>
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
                            <div className="text-[11px] text-sand-400">{formatCurrency(Number(lead.quote_amount))}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-sand-300">—</span>
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
      </div>

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

function SummaryCard({ label, value, color, subtitle }: { label: string; value: string | number; color: string; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <p className="text-[11px] text-sand-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-semibold text-sand-900">{value}</p>
      {subtitle && <p className="text-[11px] text-sand-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}
