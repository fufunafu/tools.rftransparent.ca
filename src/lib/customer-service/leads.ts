// Shared types + payload-extraction helpers for the Leads section.

export type LeadSource = "website" | "meta";
export type CallStatus = "not_called" | "no_answer" | "called";
export type Outcome = "new" | "contacted" | "quoted" | "won" | "lost";

export interface LeadCallAttempt {
  id: string;
  lead_id: string;
  staff: string;
  result: string;
  notes: string | null;
  called_at: string;
}

export interface Lead {
  id: string;
  source: LeadSource;
  source_detail: string | null;
  form_id: string | null;
  page_url: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  raw_payload: Record<string, unknown>;
  submitted_at: string;
  call_status: CallStatus;
  outcome: Outcome;
  quote_number: string | null;
  quote_amount: string | number | null;
  quote_sent_at: string | null;
  lost_reason: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  // Joined call attempt counts when present
  call_attempts_count?: number;
  last_call_at?: string | null;
  last_called_by?: string | null;
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  not_called: "Not called",
  no_answer: "No answer",
  called: "Called",
};

/**
 * Pull common contact fields out of a form submission.
 *
 * Priority order:
 *   1. `payload.mapped` — explicit per-form mapping set in the install script
 *      (most reliable, the user chooses which field is what).
 *   2. Common key names + Powerful Form Builder defaults (text, phone-1,
 *      textarea-1, …) as a best-effort fallback.
 *
 * The raw payload is always stored separately, so nothing is lost regardless.
 */
export function extractContactFields(payload: Record<string, unknown>): {
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
} {
  // 1) Prefer explicit mapping from the install script
  if (isRecord(payload.mapped)) {
    return {
      name: cleanStr(payload.mapped.name),
      email: cleanStr(payload.mapped.email),
      phone: cleanStr(payload.mapped.phone),
      message: cleanStr(payload.mapped.message),
    };
  }

  // 2) Heuristic fallback
  const fields = isRecord(payload.fields) ? payload.fields : payload;

  const first = pickString(fields, ["first_name", "firstname", "given_name"]);
  const last = pickString(fields, ["last_name", "lastname", "family_name", "surname"]);
  const full = pickString(fields, [
    "name",
    "full_name",
    "fullname",
    "your_name",
    "your-name",
    "customer_name",
    "contact_name",
    // Powerful Form Builder default for the first text input
    "text",
  ]);
  const name = full ?? ([first, last].filter(Boolean).join(" ") || null);

  const email = pickString(fields, [
    "email",
    "your_email",
    "your-email",
    "email_address",
    "e-mail",
    "customer_email",
  ]);

  const phone = pickString(fields, [
    "phone",
    "tel",
    "telephone",
    "your_phone",
    "your-phone",
    "phone_number",
    "mobile",
    "cell",
    "customer_phone",
    // Powerful Form Builder defaults
    "phone-1",
    "phone-2",
  ]);

  const message = pickString(fields, [
    "message",
    "your_message",
    "your-message",
    "comments",
    "comment",
    "notes",
    "details",
    "description",
    "inquiry",
    // Powerful Form Builder defaults
    "textarea-1",
    "textarea-2",
  ]);

  return { name, email, phone, message };
}

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // Try case-insensitive match as a last resort
  const lowerMap = Object.keys(obj).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase()] = k;
    return acc;
  }, {});
  for (const k of keys) {
    const real = lowerMap[k.toLowerCase()];
    if (real) {
      const v = obj[real];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}
