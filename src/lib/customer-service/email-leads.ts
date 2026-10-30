// Turns form notifications that only exist as email into leads.
//
// The glass-railings.com and Glass Fence Direct storefronts use Shopify's
// built-in contact form, which has no webhook: Shopify only emails the
// submission to info@glassrailingstore.com (where Gmail files it under the
// Social tab). Judge.me product questions arrive the same way. Neither ever
// reached the Leads page, so this job reads those notifications from Gmail
// and saves each one as a website lead.

import { INBOXES, readGmailMessages, type GmailMessageWithBody } from "@/lib/gmail";
import { findOrInsertLead, type LeadStoreId } from "@/lib/customer-service/leads";
import { getSetting, putSetting } from "@/lib/settings";
import { getSupabase } from "@/lib/supabase";

export const EMAIL_LEAD_INBOX = "info@glassrailingstore.com";
// GRS website leads are stored under the RF store, like the Powerful Form ones.
export const EMAIL_LEAD_STORE: LeadStoreId = "rf_transparent";
export const JUDGEME_SOURCE_DETAIL = "Judge.me product question";
const PROCESSED_KEY = "email_lead_ingestion:processed";
const PROCESSED_LIMIT = 2000;

export function emailLeadQuery(days: number): string {
  return `((from:mailer@shopify.com subject:"New customer message") OR (from:judge.me subject:"New question for product")) newer_than:${days}d`;
}

export interface EmailLeadField {
  label: string;
  value: string;
}

export interface ParsedEmailLead {
  provider: "shopify_contact_form" | "judgeme_question";
  sourceDetail: string;
  storeName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  fields: EmailLeadField[];
}

type EmailInput = Pick<GmailMessageWithBody, "from" | "subject" | "body">;

const LABEL_LINE = /^([A-Za-z][A-Za-z0-9 %{}_./()&'-]{0,60}?):\s*(.*)$/;
const SHOPIFY_FOOTER = /\n\s*(?:You can reply to this|Reply to this email|Why did I receive|View (?:in|on) Shopify|©)/i;

function displayName(from: string): string {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*</);
  return match ? match[1].trim() : "";
}

function clean(value: string | undefined | null): string | null {
  const text = (value ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text || null;
}

/** Parse Shopify's "New customer message on ..." contact form notification. */
export function parseShopifyContactNotification(msg: EmailInput): ParsedEmailLead | null {
  if (!/mailer@shopify\.com/i.test(msg.from) || !/^New customer message on\b/i.test(msg.subject.trim())) {
    return null;
  }
  const storeName = displayName(msg.from).replace(/\s*\(Shopify\)\s*$/i, "").trim() || "Shopify store";
  let text = msg.body.replace(/\r\n?/g, "\n");
  const intro = text.search(/contact form\.?/i);
  if (intro >= 0) text = text.slice(intro).replace(/^contact form\.?/i, "");
  const footer = text.search(SHOPIFY_FOOTER);
  if (footer >= 0) text = text.slice(0, footer);

  const entries: { label: string; lines: string[] }[] = [];
  let body: string[] | null = null;
  for (const line of text.split("\n")) {
    if (body) {
      body.push(line);
      continue;
    }
    const match = line.trim().match(LABEL_LINE);
    if (match) {
      const label = match[1].trim();
      if (/^body$/i.test(label)) {
        body = match[2] ? [match[2]] : [];
        continue;
      }
      entries.push({ label, lines: match[2] ? [match[2]] : [] });
    } else if (entries.length > 0) {
      entries[entries.length - 1].lines.push(line);
    }
  }

  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  const fields: EmailLeadField[] = [];
  for (const entry of entries) {
    const value = clean(entry.lines.join("\n"));
    const label = /^New customer message on/i.test(entry.label) ? "Topic" : entry.label;
    if (/^name$/i.test(label)) name = value;
    else if (/^e-?mail$/i.test(label)) email = value?.match(/[^\s<>]+@[^\s<>]+/)?.[0]?.toLowerCase() ?? null;
    else if (/^phone$/i.test(label)) phone = value;
    else if (value && !/^country code$/i.test(label)) fields.push({ label, value });
  }

  return {
    provider: "shopify_contact_form",
    sourceDetail: `Shopify contact form: ${storeName}`,
    storeName,
    name,
    email,
    phone,
    message: clean(body?.join("\n")),
    fields,
  };
}

/** Parse Judge.me's "New question for product ..." notification. */
export function parseJudgeMeQuestion(msg: EmailInput): ParsedEmailLead | null {
  if (!/judge\.me/i.test(msg.from) || !/^New question for product\b/i.test(msg.subject.trim())) {
    return null;
  }
  const text = msg.body.replace(/\r\n?/g, "\n");
  const product = msg.subject.trim().replace(/^New question for product\s*/i, "").trim();
  const question = clean(text.match(/Question:\s*([\s\S]*?)\s*(?:Click here|P\.S\.|Kind regards|$)/i)?.[1]);
  const email = text.match(/contact the \w+ via\s+([^\s<>]+@[^\s<>]+?)\.?(?:\s|$)/i)?.[1]?.toLowerCase() ?? null;
  return {
    provider: "judgeme_question",
    sourceDetail: JUDGEME_SOURCE_DETAIL,
    storeName: null,
    name: null,
    email,
    phone: null,
    message: question ? `Question about ${product}: ${question}` : null,
    fields: product ? [{ label: "Product", value: product }] : [],
  };
}

export function parseEmailLead(msg: EmailInput): ParsedEmailLead | null {
  return parseShopifyContactNotification(msg) ?? parseJudgeMeQuestion(msg);
}

/** Shape fields the way the Leads page reads form submissions (`fields._keyLabel`). */
export function leadFieldsPayload(fields: EmailLeadField[]): Record<string, unknown> {
  const keyLabel: Record<string, string> = {};
  const payload: Record<string, unknown> = {};
  fields.forEach((field, index) => {
    const base = field.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `field_${index + 1}`;
    let key = base;
    for (let n = 2; key in payload; n++) key = `${base}_${n}`;
    keyLabel[key] = field.label;
    payload[key] = field.value;
  });
  return { _keyLabel: keyLabel, ...payload };
}

export interface EmailLeadIngestResult {
  scanned: number;
  inserted: number;
  merged: number;
  skipped: number;
  errors: string[];
}

async function alreadyImportedIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await getSupabase()
    .from("leads")
    .select("gmail_message_id:raw_payload->>gmail_message_id")
    .in("raw_payload->>gmail_message_id", ids);
  if (error) throw new Error(`Could not check imported emails: ${error.message}`);
  return new Set((data ?? []).map((row: { gmail_message_id: string | null }) => row.gmail_message_id ?? ""));
}

export async function ingestEmailLeads(options: {
  days: number;
  maxMessages: number;
  notify: boolean;
}): Promise<EmailLeadIngestResult> {
  const inbox = INBOXES.find((candidate) => candidate.email === EMAIL_LEAD_INBOX);
  if (!inbox) throw new Error(`${EMAIL_LEAD_INBOX} is not a configured inbox`);

  const messages = await readGmailMessages(inbox, emailLeadQuery(options.days), options.maxMessages);
  const ledger = await getSetting<{ ids: string[] }>(PROCESSED_KEY, { ids: [] });
  const processed = new Set([...ledger.ids, ...(await alreadyImportedIds(messages.map((m) => m.id)))]);
  const result: EmailLeadIngestResult = { scanned: messages.length, inserted: 0, merged: 0, skipped: 0, errors: [] };
  const done: string[] = [];

  for (const message of messages) {
    if (processed.has(message.id)) continue;
    const lead = parseEmailLead(message);
    if (!lead) {
      result.skipped++;
      done.push(message.id);
      continue;
    }
    const saved = await findOrInsertLead({
      store_id: EMAIL_LEAD_STORE,
      source: "website",
      source_detail: lead.sourceDetail,
      form_id: null,
      page_url: null,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      message: lead.message,
      submitted_at: message.receivedAt,
      send_notification: options.notify,
      raw_payload: {
        provider: lead.provider,
        gmail_message_id: message.id,
        gmail_thread_id: message.threadId,
        inbox: EMAIL_LEAD_INBOX,
        ...(lead.storeName ? { shopify_store: lead.storeName } : {}),
        fields: leadFieldsPayload(lead.fields),
      },
    });
    if (!saved.ok) {
      // Leave it out of the ledger so the next run retries it.
      result.errors.push(`${message.id}: ${saved.error}`);
      continue;
    }
    if ("skipped" in saved) result.skipped++;
    else if (saved.deduped) result.merged++;
    else result.inserted++;
    done.push(message.id);
  }

  if (done.length > 0) {
    await putSetting(PROCESSED_KEY, { ids: [...ledger.ids, ...done].slice(-PROCESSED_LIMIT) });
  }
  return result;
}
