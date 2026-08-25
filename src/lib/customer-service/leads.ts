// Shared types + payload-extraction helpers for the Leads section.

import { getSupabase } from "@/lib/supabase";
import { escapeIlikeValue, quotePostgrestValue } from "@/lib/postgrest";
import { sendNewLeadNotification } from "@/lib/lead-notifications";
import type { LeadAttachment } from "@/lib/customer-service/lead-attachments";
import {
  LEAD_SPAM_REASON,
  assessLeadSpam,
} from "@/lib/customer-service/lead-spam";

import type { LeadStoreId } from "@/lib/customer-service/lead-store";

export type { LeadStoreId } from "@/lib/customer-service/lead-store";
export type LeadSource = "website" | "meta";
export type CallStatus = "not_called" | "no_answer" | "called";
export type Outcome = "new" | "contacted" | "quoted" | "won" | "lost" | "not_applicable";

export const HISTORICAL_UNKNOWN_REASON =
  "Historical Powerful Form Builder record; workflow status unknown";

export interface LeadCallAttempt {
  id: string;
  lead_id: string;
  staff: string;
  result: string;
  notes: string | null;
  called_at: string;
}

export interface LeadSubmission {
  id: string;
  source: LeadSource;
  source_detail: string | null;
  form_id: string | null;
  page_url: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  installation_requested: boolean | null;
  raw_payload: Record<string, unknown>;
  submitted_at: string;
  attachments?: LeadAttachment[];
}

export interface Lead {
  id: string;
  store_id: LeadStoreId;
  source: LeadSource;
  source_detail: string | null;
  form_id: string | null;
  page_url: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  installation_requested: boolean | null;
  raw_payload: Record<string, unknown>;
  submitted_at: string;
  call_status: CallStatus;
  outcome: Outcome;
  quote_number: string | null;
  quote_amount: string | number | null;
  quote_sent_at: string | null;
  first_quote_at?: string | null;
  lost_reason: string | null;
  not_applicable_reason: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  // Joined call attempt counts when present
  call_attempts_count?: number;
  first_call_at?: string | null;
  last_call_at?: string | null;
  last_called_by?: string | null;
  duplicate_count?: number;
  duplicate_ids?: string[];
  submissions?: LeadSubmission[];
  attachments?: LeadAttachment[];
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  not_applicable: "Not Applicable",
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
  const fields = isRecord(payload.fields) ? payload.fields : payload;
  const mapped = isRecord(payload.mapped) ? payload.mapped : {};
  const labeled = extractLabeledContactFields(fields);

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
  const heuristicName = full ?? ([first, last].filter(Boolean).join(" ") || null);

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

  const resolvedEmail = cleanStr(mapped.email) ?? labeled.email ?? email;
  const resolvedPhone = cleanStr(mapped.phone) ?? labeled.phone ?? phone;
  // Last resort for forms whose keys and labels we do not recognise (e.g. a
  // French form): find anything that looks like an email or phone number.
  const scanned = resolvedEmail && resolvedPhone ? null : scanContactValues(fields);

  return {
    name: cleanStr(mapped.name) ?? labeled.name ?? heuristicName,
    email: resolvedEmail ?? scanned?.email ?? null,
    phone: resolvedPhone ?? scanned?.phone ?? null,
    message: cleanStr(mapped.message) ?? labeled.message ?? message,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_PATTERN = /^\+?[\d\s().-]{10,20}$/;

function scanContactValues(
  fields: Record<string, unknown>,
): { email: string | null; phone: string | null } {
  let email: string | null = null;
  let phone: string | null = null;
  for (const [key, raw] of Object.entries(fields)) {
    if (key.startsWith("_")) continue;
    const value = cleanStr(Array.isArray(raw) ? raw[0] : raw);
    if (!value) continue;
    if (!email && EMAIL_PATTERN.test(value)) email = value;
    else if (!phone && PHONE_PATTERN.test(value) && value.replace(/\D/g, "").length >= 10) phone = value;
  }
  return { email, phone };
}

/**
 * Read an installation preference from mapped values or labeled form fields.
 *
 * Powerful Form Builder names its custom button group `button-1[]`, while its
 * `_keyLabel` metadata identifies the same control as `button-1`. Supporting
 * both forms keeps the extractor independent of that serialization detail.
 */
export function extractInstallationRequested(
  payload: Record<string, unknown>,
): boolean | null {
  const fields = isRecord(payload.fields) ? payload.fields : payload;
  const mapped = isRecord(payload.mapped) ? payload.mapped : {};
  const directKeys = [
    "installation_requested",
    "installation",
    "needs_installation",
    "need_installation",
    "button-1",
  ];

  for (const key of directKeys) {
    const mappedValue = parseInstallationValue(mapped[key]);
    if (mappedValue !== null) return mappedValue;

    const fieldValue = parseInstallationValue(findSerializedFieldValue(fields, key));
    if (fieldValue !== null) return fieldValue;
  }

  for (const [key, label] of Object.entries(formFieldLabels(fields))) {
    if (!/(^| )install(ation|er|ing)?( |$)/.test(normalizedLabel(label))) continue;
    const value = parseInstallationValue(findSerializedFieldValue(fields, key));
    if (value !== null) return value;
  }

  return null;
}

export interface LeadSubmissionDetail {
  key: string;
  label: string;
  value: string;
}

/** Turn labeled form fields into useful, human-readable lead details. */
export function extractSubmissionDetails(
  payload: Record<string, unknown>,
): LeadSubmissionDetail[] {
  const fields = isRecord(payload.fields) ? payload.fields : payload;
  const labels = formFieldLabels(fields);
  const details: LeadSubmissionDetail[] = [];

  for (const [key, label] of Object.entries(labels)) {
    const value = displayFieldValue(findSerializedFieldValue(fields, key));
    if (!value || isContactLabel(label)) continue;
    details.push({ key, label, value });
  }

  return details;
}

/**
 * Pull contact fields out of a Meta Lead Ads `field_data` array.
 *
 *   [{name: "full_name", values: ["Jane Doe"]}, {name: "email", values: [...]}, ...]
 *
 * Recognized field names map to the standard contact slots. Anything else
 * (custom-question answers) is folded into `message` so we never lose data.
 */
export function extractMetaLeadFields(
  fieldData: ReadonlyArray<{ name?: unknown; values?: unknown }>,
): { name: string | null; email: string | null; phone: string | null; message: string | null } {
  const map: Record<string, string> = {};
  const extras: Array<{ name: string; value: string }> = [];

  const recognized = new Set([
    "full_name", "first_name", "last_name", "name",
    "email",
    "phone_number", "phone",
  ]);

  for (const f of fieldData) {
    if (typeof f.name !== "string") continue;
    const key = f.name.toLowerCase();
    const value = Array.isArray(f.values) && typeof f.values[0] === "string" ? f.values[0].trim() : "";
    if (!value) continue;
    map[key] = value;
    if (!recognized.has(key)) {
      extras.push({ name: f.name, value });
    }
  }

  const first = map["first_name"];
  const last = map["last_name"];
  const full = map["full_name"] ?? map["name"];
  const name = full ?? ([first, last].filter(Boolean).join(" ") || null);

  const email = map["email"] ?? null;
  const phone = map["phone_number"] ?? map["phone"] ?? null;

  const message =
    extras.length > 0
      ? extras.map(({ name: n, value }) => `${prettifyFieldName(n)}: ${value}`).join("\n")
      : null;

  return { name, email, phone, message };
}

function prettifyFieldName(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Shared idempotent insert for incoming leads (any source).
 *
 *   - Strips stray whitespace from the email.
 *   - Drops submissions with no email AND no phone (returns `skipped: "no_contact"`).
 *   - If a row from the same source form already exists in the last 24 hours
 *     and matches on email or phone, enriches that row instead of inserting.
 */
export interface UpsertLeadInput {
  store_id: LeadStoreId;
  source: LeadSource;
  source_detail: string | null;
  form_id: string | null;
  page_url: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  installation_requested?: boolean | null;
  raw_payload: Record<string, unknown>;
  // Stable provider identifier, such as Meta's leadgen_id. This is kept in
  // raw_payload so ingestion stays idempotent without a schema dependency.
  external_id?: string | null;
  // Preserve the provider's submission time during historical imports.
  submitted_at?: string | null;
  // Historical imports should not generate one email per backfilled lead.
  send_notification?: boolean;
}

export type UpsertLeadResult =
  | { ok: true; lead_id: string; deduped: boolean }
  | { ok: true; skipped: "no_contact" }
  | { ok: false; error: string };

export async function findOrInsertLead(input: UpsertLeadInput): Promise<UpsertLeadResult> {
  const email = input.email ? input.email.replace(/\s+/g, "") || null : null;
  const phone = input.phone?.trim() || null;
  const spam = assessLeadSpam({
    source: input.source,
    name: input.name,
    email,
    message: input.message,
  });

  if (!email && !phone) {
    return { ok: true, skipped: "no_contact" };
  }

  const supabase = getSupabase();

  if (input.external_id) {
    const { data: providerMatch } = await supabase
      .from("leads")
      .select("id")
      .eq("store_id", input.store_id)
      .eq("source", input.source)
      .contains("raw_payload", { meta_lead_id: input.external_id })
      .limit(1)
      .maybeSingle();

    if (providerMatch) {
      return { ok: true, lead_id: providerMatch.id, deduped: true };
    }
  }

  const duplicateWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const orFilters: string[] = [];
  // email/phone come from public form submissions — quote them so filter
  // grammar characters (or SQL wildcards) in a submission can never widen
  // this match onto an unrelated lead, which the branch below would overwrite.
  if (email) orFilters.push(`email.ilike.${quotePostgrestValue(escapeIlikeValue(email))}`);
  if (phone) orFilters.push(`phone.eq.${quotePostgrestValue(phone)}`);
  let duplicateQuery = supabase
    .from("leads")
    .select("id,name,email,phone,message,installation_requested,raw_payload,outcome")
    .eq("store_id", input.store_id)
    .eq("source", input.source)
    .gte("submitted_at", duplicateWindowStart);
  if (input.form_id) duplicateQuery = duplicateQuery.eq("form_id", input.form_id);
  else if (input.source_detail) duplicateQuery = duplicateQuery.eq("source_detail", input.source_detail);
  const { data: existing } = await duplicateQuery
    .or(orFilters.join(","))
    .limit(1)
    .maybeSingle();

  if (existing) {
    const canAutoExclude = spam.isSpam
      && (!existing.outcome || ["new", "contacted", "not_applicable"].includes(existing.outcome));
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        name: input.name ?? existing.name ?? null,
        email: email ?? existing.email ?? null,
        phone: phone ?? existing.phone ?? null,
        message: input.message ?? existing.message ?? null,
        installation_requested:
          input.installation_requested ?? existing.installation_requested ?? null,
        raw_payload: input.raw_payload,
        ...(canAutoExclude ? {
          outcome: "not_applicable",
          not_applicable_reason: LEAD_SPAM_REASON,
        } : {}),
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updateError) return { ok: false, error: updateError.message };
    return { ok: true, lead_id: existing.id, deduped: true };
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      store_id: input.store_id,
      source: input.source,
      source_detail: input.source_detail,
      form_id: input.form_id,
      page_url: input.page_url,
      name: input.name,
      email,
      phone,
      message: input.message,
      installation_requested: input.installation_requested ?? null,
      raw_payload: input.raw_payload,
      ...(spam.isSpam ? {
        outcome: "not_applicable",
        not_applicable_reason: LEAD_SPAM_REASON,
      } : {}),
      ...(input.submitted_at ? { submitted_at: input.submitted_at } : {}),
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (input.send_notification !== false && !spam.isSpam) {
    try {
      await sendNewLeadNotification({
        leadId: data.id,
        storeId: input.store_id,
        source: input.source,
        sourceDetail: input.source_detail,
        pageUrl: input.page_url,
        name: input.name,
        email,
        phone,
        message: input.message,
        installationRequested: input.installation_requested ?? null,
      });
    } catch (notificationError) {
      // The lead is already saved. Never ask a webhook provider to retry it
      // because a secondary notification failed.
      console.error("[leads] notification failed:", notificationError);
    }
  }

  return { ok: true, lead_id: data.id, deduped: false };
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

function formFieldLabels(fields: Record<string, unknown>): Record<string, string> {
  const raw = fields._keyLabel;
  if (isRecord(raw)) {
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  }
  if (typeof raw !== "string") return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function normalizedLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isContactLabel(label: string): boolean {
  const normalized = normalizedLabel(label);
  return /^(full )?name$/.test(normalized)
    || /^(first|last|given|family|customer|contact) name$/.test(normalized)
    || /email/.test(normalized)
    || /(^| )(phone|telephone|mobile|cell)( |$)/.test(normalized)
    || /^(message|comments?|notes?|details|description|inquiry|project details)$/.test(normalized);
}

function extractLabeledContactFields(fields: Record<string, unknown>): {
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
} {
  let fullName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  let message: string | null = null;

  for (const [key, label] of Object.entries(formFieldLabels(fields))) {
    const value = cleanStr(fields[key]);
    if (!value) continue;
    const normalized = normalizedLabel(label);

    if (/^(full name|name|customer name|contact name)$/.test(normalized)) fullName ??= value;
    else if (/^(first name|given name)$/.test(normalized)) firstName ??= value;
    else if (/^(last name|family name|surname)$/.test(normalized)) lastName ??= value;
    else if (/email/.test(normalized)) email ??= value;
    else if (/(^| )(phone|telephone|mobile|cell)( |$)/.test(normalized)) phone ??= value;
    else if (/^(message|comments?|notes?|details|description|inquiry|project details)$/.test(normalized)) message ??= value;
  }

  return {
    name: fullName ?? ([firstName, lastName].filter(Boolean).join(" ") || null),
    email,
    phone,
    message,
  };
}

function displayFieldValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const values = value.map(displayFieldValue).filter((item): item is string => Boolean(item));
    return values.length > 0 ? values.join(", ") : null;
  }
  return null;
}

function findSerializedFieldValue(
  fields: Record<string, unknown>,
  key: string,
): unknown {
  if (key in fields) return fields[key];
  const bracketedKey = key.endsWith("[]") ? key : `${key}[]`;
  if (bracketedKey in fields) return fields[bracketedKey];
  const plainKey = key.endsWith("[]") ? key.slice(0, -2) : key;
  return fields[plainKey];
}

function parseInstallationValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseInstallationValue(item);
      if (parsed !== null) return parsed;
    }
    return null;
  }
  if (typeof value !== "string") return null;

  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return null;
  if (
    /^(no|false|0)\b/.test(normalized)
    || /\b(without|decline) installation\b/.test(normalized)
    || /\b(no installation|self install|diy)\b/.test(normalized)
  ) return false;
  if (
    /^(yes|true|1)\b/.test(normalized)
    || /\b(with installation|installation required|professional installation)\b/.test(normalized)
    || /\bneed(s|ed)? installation\b/.test(normalized)
  ) return true;
  return null;
}
