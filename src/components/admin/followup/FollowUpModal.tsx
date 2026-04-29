"use client";

import { useState } from "react";
import {
  FOLLOWUP_CATEGORIES,
  DEFAULT_FOLLOWUP_DAYS,
  LOSS_REASONS,
  MAX_ATTEMPTS,
  type LeadStatus,
  type FollowUpLead,
} from "@/lib/followup";

const OUTCOME_OPTIONS: { value: LeadStatus; label: string; color: string }[] = [
  { value: "hot_lead",       label: "Hot Lead",       color: "bg-red-100 text-red-700 border-red-200" },
  { value: "considering",    label: "Considering",    color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "price_shopping", label: "Price Shopping",  color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "future_project", label: "Future Project",  color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "no_answer",      label: "No Answer",      color: "bg-gray-100 text-gray-600 border-gray-200" },
  { value: "lost",           label: "Lost",           color: "bg-slate-100 text-slate-600 border-slate-200" },
  { value: "duplicate",      label: "Duplicate",      color: "bg-slate-100 text-slate-500 border-slate-200" },
];

interface Props {
  lead: FollowUpLead;
  storeDays?: Record<string, number | null>;
  onClose: () => void;
  onSubmit: (data: {
    lead_id: string;
    outcome: LeadStatus;
    notes?: string;
    close_reason?: string;
    custom_date?: string;
  }) => Promise<void>;
}

function getPreviewDate(outcome: LeadStatus, customDate: string, storeDays?: Record<string, number | null>): string {
  const cat = FOLLOWUP_CATEGORIES[outcome];
  if (cat.terminal) return "Lead will be closed";
  if (outcome === "future_project") {
    if (!customDate) return "Select a date";
    return `Next follow-up: ${new Date(customDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  }
  const days = storeDays?.[outcome] ?? DEFAULT_FOLLOWUP_DAYS[outcome] ?? cat.followupDays;
  if (days === null) return "";
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `Next follow-up: ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} (${days} day${days > 1 ? "s" : ""})`;
}

export default function FollowUpModal({ lead, storeDays, onClose, onSubmit }: Props) {
  const [outcome, setOutcome] = useState<LeadStatus | "">("");
  const [notes, setNotes] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Required acknowledgement when closing as Lost / Too expensive — pushes the
  // rep to try a discount before giving up.
  const [discountOffered, setDiscountOffered] = useState(false);

  const nearMax = lead.followup_count >= MAX_ATTEMPTS - 1;
  const atMax = lead.followup_count >= MAX_ATTEMPTS;
  const selectedCat = outcome ? FOLLOWUP_CATEGORIES[outcome] : null;
  const requiresNotes = selectedCat?.requiresNotes ?? false;
  const isLost = outcome === "lost";
  const isFutureProject = outcome === "future_project";
  const isTooExpensive = isLost && closeReason === "Too expensive";

  const canSubmit =
    outcome !== "" &&
    (!requiresNotes || notes.trim()) &&
    (!isLost || closeReason) &&
    (!isLost || notes.trim().length >= 50) &&
    (!isTooExpensive || discountOffered) &&
    (!isFutureProject || customDate) &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !outcome) return;
    setSubmitting(true);
    try {
      await onSubmit({
        lead_id: lead.id,
        outcome,
        notes: notes.trim() || undefined,
        close_reason: isLost ? closeReason : undefined,
        custom_date: isFutureProject ? customDate : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-sand-200/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-sand-900">Log Follow-up</h3>
              <p className="text-sm text-sand-500 mt-0.5">
                {lead.draft_name} &middot; {lead.customer_name || "Unknown customer"} &middot; {new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(lead.quote_amount))}
              </p>
            </div>
            <button onClick={onClose} className="text-sand-400 hover:text-sand-600 p-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Max attempts warning */}
          {atMax && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-red-700">
                This lead has reached {MAX_ATTEMPTS} follow-up attempts.
              </p>
              <p className="text-xs text-red-600 mt-1">
                Consider closing as Lost if the customer remains unresponsive.
              </p>
            </div>
          )}
          {nearMax && !atMax && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-sm text-amber-700">
                Attempt {lead.followup_count + 1} of {MAX_ATTEMPTS} — one more before the recommended limit.
              </p>
            </div>
          )}

          {/* Outcome selector */}
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-2">Outcome</label>
            <div className="grid grid-cols-2 gap-2">
              {OUTCOME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setOutcome(opt.value)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border-2 transition-all ${
                    outcome === opt.value
                      ? `${opt.color} ring-2 ring-offset-1 ring-blue-400`
                      : "border-sand-200 text-sand-600 hover:border-sand-300 hover:bg-sand-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Loss reason (when Lost selected) */}
          {isLost && (
            <div>
              <label className="block text-sm font-medium text-sand-700 mb-2">
                Why was the lead lost? <span className="text-red-500">*</span>
              </label>
              <div className="space-y-1.5">
                {LOSS_REASONS.map((reason) => (
                  <label key={reason} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="closeReason"
                      value={reason}
                      checked={closeReason === reason}
                      onChange={() => {
                        setCloseReason(reason);
                        if (reason !== "Too expensive") setDiscountOffered(false);
                      }}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-sand-700">{reason}</span>
                  </label>
                ))}
              </div>

              {isTooExpensive && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-sm text-amber-800">
                    Hey — have you tried offering this customer a 5% discount before marking them lost?
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={discountOffered}
                      onChange={(e) => setDiscountOffered(e.target.checked)}
                      className="mt-0.5 text-blue-600"
                    />
                    <span className="text-sm text-amber-900">
                      I offered a discount and they still declined. <span className="text-red-500">*</span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Custom date (when Future Project selected) */}
          {isFutureProject && (
            <div>
              <label className="block text-sm font-medium text-sand-700 mb-2">
                When should we follow up? <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                className="w-full px-3 py-2 border border-sand-200 rounded-lg text-sm text-sand-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-2">
              Notes {requiresNotes && <span className="text-red-500">*</span>}
              {outcome === "considering" && (
                <span className="text-sand-400 font-normal"> — what are they considering?</span>
              )}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                outcome === "considering" ? "e.g., Needs to discuss with spouse, comparing materials..."
                : outcome === "lost" ? "Explain why the lead was lost..."
                : "Optional notes about this follow-up..."
              }
              rows={3}
              className="w-full px-3 py-2 border border-sand-200 rounded-lg text-sm text-sand-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {isLost && (
              <p className={`text-xs mt-1 ${notes.trim().length >= 50 ? "text-sand-400" : "text-red-500"}`}>
                {notes.trim().length}/50 minimum characters
              </p>
            )}
          </div>

          {/* Preview */}
          {outcome && (
            <div className="bg-sand-50 rounded-lg px-4 py-3">
              <p className="text-sm text-sand-600">
                {getPreviewDate(outcome as LeadStatus, customDate, storeDays)}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-sand-200/60 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-sand-600 hover:text-sand-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
              canSubmit
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-sand-200 text-sand-400 cursor-not-allowed"
            }`}
          >
            {submitting ? "Saving..." : "Log Follow-up"}
          </button>
        </div>
      </div>
    </div>
  );
}
