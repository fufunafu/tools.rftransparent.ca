import "server-only";
import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";
import { normalizeEmail, normalizePhone } from "./identity.mjs";

export interface CaptureEvent {
  id: string; kind: "calls" | "emails"; revision: number; source_key: string;
  occurred_at: string; contact_id: string | null; record_id: string | null;
  payload: Record<string, unknown>;
}
export function captureIdentity(event: CaptureEvent) {
  const p = event.payload;
  if (p.direction !== "inbound" && p.direction !== "outbound") return null;
  const raw = event.kind === "emails"
    ? p.direction === "inbound" ? p.from_email : p.to_email
    : p.direction === "inbound" ? p.from_number : p.to_number;
  const value = event.kind === "emails" ? normalizeEmail(raw) : normalizePhone(raw);
  return value ? { kind: event.kind === "emails" ? "email" : "phone", value } : null;
}
export function captureContent(event: CaptureEvent) {
  const p = event.payload;
  if (event.kind === "emails") {
    return {
      title: String(p.subject || "Email conversation"),
      summary: `Automatic email preview · ${p.inbox} · ${p.direction}`,
      body: `Automatically captured from the shared inbox ${p.inbox}.\nFrom: ${p.from_email}\nTo: ${p.to_email}\n\n${p.snippet || "No preview available."}\n\nThis is a preview from the existing email sync. The full email and attachments remain in the mailbox.`,
    };
  }
  return {
    title: `${p.direction === "outbound" ? "Outbound" : "Inbound"} phone call`,
    summary: `Automatic call record · ${p.source} · ${p.from_number} → ${p.to_number}`,
    body: `Automatically captured from ${p.source}.\nFrom: ${p.from_number}\nTo: ${p.to_number}\nDuration: ${Number(p.duration_min) || 0} minutes\nPhone endpoint: ${p.endpoint || "Not supplied"}\n\nThe phone provider does not identify a verified staff member for this record.`,
  };
}

async function forwardedDuplicate(event: CaptureEvent): Promise<boolean> {
  const p = event.payload;
  if (event.kind !== "calls" || p.direction !== "inbound") return false;
  const time = Date.parse(event.occurred_at);
  const { data, error } = await getSupabase().from("crm_capture_events").select("id,payload,record_id,status")
    .eq("kind", "calls").gte("occurred_at", new Date(time - 120000).toISOString()).lte("occurred_at", new Date(time + 120000).toISOString()).neq("id", event.id).limit(200);
  if (error) throw new Error("Call matching unavailable");
  return (data ?? []).some(other => {
    const candidate = other.payload as Record<string, unknown>;
    return candidate.store_id === p.store_id && candidate.direction === "inbound" && candidate.source !== p.source
      && normalizePhone(candidate.from_number) === normalizePhone(p.from_number)
      && (Boolean(other.record_id) || (p.source === "cik" && candidate.source === "grasshopper"));
  });
}

export async function captureCrmActivity() {
  const db = getSupabase();
  const token = crypto.randomUUID();
  const employees = await db.from("employees").select("email,email_alt");
  if (employees.error) throw new Error("Staff exclusions unavailable");
  const staff = new Set([OWNER_EMAIL, ...(employees.data ?? []).flatMap(row => [row.email, row.email_alt]).filter(Boolean).map(value => String(value).toLowerCase())]);
  const claimed = await db.rpc("crm_claim_capture", { p_token: token, p_limit: 50 });
  if (claimed.error) throw new Error("Activity capture queue unavailable");
  const counts = { captured: 0, review: 0, ignored: 0 };
  for (const event of (claimed.data ?? []) as CaptureEvent[]) {
    const identity = captureIdentity(event);
    let status: "captured" | "review" | "ignored" = "review";
    let reason = "missing_identity";
    let matchedIds: string[] = [];
    let contactId: string | null = null;
    if (identity?.kind === "email" && (staff.has(identity.value) || /@(glass-railing\.com|glassrailingstore\.com|cloture-verre\.com|rftransparent\.ca)$/.test(identity.value))) {
      status = "ignored"; reason = "internal_email";
    } else if (identity && await forwardedDuplicate(event)) {
      status = "ignored"; reason = "forwarded_call";
    } else if (identity) {
      const matches = await db.from("crm_identities").select("record_id,crm_records!inner(archived)")
        .eq("kind", identity.kind).eq("value", identity.value).eq("crm_records.archived", false).limit(100);
      if (matches.error) throw new Error("Customer matching unavailable");
      matchedIds = [...new Set((matches.data ?? []).map(row => String(row.record_id)))];
      if (matchedIds.length === 1 && (!event.contact_id || event.contact_id === matchedIds[0])) {
        status = "captured"; reason = "exact_identity"; contactId = matchedIds[0];
      } else reason = matchedIds.length ? "ambiguous_identity" : "no_customer_match";
    }
    const result = await db.rpc("crm_finish_capture", {
      p_id: event.id, p_token: token, p_revision: event.revision,
      p_result: { status, reason, matched_ids: matchedIds, contact_id: contactId, ...captureContent(event) },
    });
    if (result.error) throw new Error("Activity capture could not be saved");
    counts[status] += 1;
  }
  return counts;
}
