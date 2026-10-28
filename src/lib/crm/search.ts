import "server-only";
import { getSupabase } from "@/lib/supabase";
import { CrmInputError } from "./input";
import { crmSearchFilter, effectiveRecord, FOLLOWUP_COLUMNS, SUMMARY_COLUMNS } from "./data";
import { normalizeEmail, normalizePhone } from "./identity.mjs";
import type { CrmRecord } from "./types";

export interface CrmSearchResults { contacts: CrmRecord[]; companies: CrmRecord[]; tasks: CrmRecord[] }
export interface CrmDuplicateMatch { id: string; title: string; object_type: CrmRecord["object_type"]; reason: "email" | "phone" | "name"; detail: string }

/** A few best matches per section for the global search box. No exact counts. */
export async function searchCrm(q: string, limit = 6): Promise<CrmSearchResults> {
  const search = q.trim();
  if (search.length < 2 || search.length > 200) throw new CrmInputError("Type at least 2 characters");
  const db = getSupabase(), filter = crmSearchFilter(search);
  const directory = (type: "contacts" | "companies") => db.from("crm_directory").select(SUMMARY_COLUMNS).eq("object_type", type).eq("archived", false)
    .or(filter).order("occurred_at", { ascending: false, nullsFirst: false }).order("id").limit(limit);
  const [contacts, companies, tasks] = await Promise.all([
    directory("contacts"), directory("companies"),
    db.from("crm_records").select(SUMMARY_COLUMNS).eq("object_type", "tasks").eq("archived", false).eq("effective_task_status", "open")
      .or(filter).order("effective_due_at", { ascending: true, nullsFirst: false }).order("id").limit(limit),
  ]);
  if (contacts.error || companies.error || tasks.error) throw new Error("CRM search unavailable");
  const rows = (result: { data: unknown }) => ((result.data ?? []) as CrmRecord[]).map(effectiveRecord);
  return { contacts: rows(contacts), companies: rows(companies), tasks: rows(tasks) };
}

/** Existing active records that look like the one being created. */
export async function findCrmDuplicates(input: { type: "contacts" | "companies"; name?: string; email?: string; phone?: string }): Promise<CrmDuplicateMatch[]> {
  const db = getSupabase(), matches = new Map<string, CrmDuplicateMatch>();
  const email = input.type === "contacts" ? normalizeEmail(input.email ?? "") : null;
  const phone = input.type === "contacts" ? normalizePhone(input.phone ?? "") : null;
  const name = (input.name ?? "").trim().toLowerCase();
  const identities = [email && { kind: "email", value: email }, phone && { kind: "phone", value: phone }].filter(Boolean) as { kind: "email" | "phone"; value: string }[];
  const [nameRows, ...identityResults] = await Promise.all([
    name.length >= 2 ? db.from("crm_directory").select("id,title,object_type,local_fields").eq("object_type", input.type).eq("archived", false).eq("directory_name", name).limit(5) : Promise.resolve({ data: [], error: null }),
    ...identities.map(item => db.from("crm_identities").select("record_id,kind,value").eq("kind", item.kind).eq("value", item.value).limit(5)),
  ]);
  if (nameRows.error || identityResults.some(result => result.error)) throw new Error("Duplicate check unavailable");
  const hits = identityResults.flatMap(result => (result.data ?? []) as { record_id: string; kind: "email" | "phone"; value: string }[]);
  if (hits.length) {
    const records = await db.from("crm_directory").select("id,title,object_type,local_fields").in("id", [...new Set(hits.map(hit => hit.record_id))]).eq("archived", false);
    if (records.error) throw new Error("Duplicate check unavailable");
    for (const record of (records.data ?? []) as CrmRecord[]) {
      const hit = hits.find(row => row.record_id === record.id)!;
      matches.set(record.id, { id: record.id, title: record.local_fields?.title || record.title, object_type: record.object_type, reason: hit.kind, detail: hit.value });
    }
  }
  for (const record of (nameRows.data ?? []) as CrmRecord[]) {
    if (!matches.has(record.id)) matches.set(record.id, { id: record.id, title: record.local_fields?.title || record.title, object_type: record.object_type, reason: "name", detail: record.local_fields?.title || record.title });
  }
  return [...matches.values()].slice(0, 5);
}

export interface CrmAssociation { id: string; title: string; source: CrmRecord["source"]; object_type: CrmRecord["object_type"]; view_fields?: Record<string, string>; local_fields?: Record<string, string>; summary: string; removable: boolean }

/** Contacts and companies linked to a record, with whether Tools can remove the link. */
export async function recordAssociations(id: string): Promise<CrmAssociation[]> {
  const db = getSupabase();
  const [outbound, inbound] = await Promise.all([
    db.from("crm_links").select("to_id,source").eq("from_id", id).limit(500),
    db.from("crm_links").select("from_id,source").eq("to_id", id).limit(500),
  ]);
  if (outbound.error || inbound.error) throw new Error("Associations unavailable");
  const links = [
    ...((outbound.data ?? []) as { to_id: string; source: string }[]).map(link => ({ id: link.to_id, source: link.source })),
    ...((inbound.data ?? []) as { from_id: string; source: string }[]).map(link => ({ id: link.from_id, source: link.source })),
  ];
  // A link is removable only when every connection between the pair came from Tools.
  const imported = new Set(links.filter(link => link.source !== "tools").map(link => link.id));
  const ids = [...new Set(links.map(link => link.id))];
  if (!ids.length) return [];
  const records = await db.from("crm_records").select("id,title,source,object_type,view_fields,local_fields,summary").in("id", ids.slice(0, 500)).in("object_type", ["contacts", "companies"]).eq("archived", false)
    .order("title").limit(100);
  if (records.error) throw new Error("Associations unavailable");
  return ((records.data ?? []) as CrmAssociation[]).map(record => ({ ...record, title: record.local_fields?.title || record.title, removable: !imported.has(record.id) }));
}

/** First linked contact or company for each record, for task and activity lists. */
export async function associationLabels(ids: string[]): Promise<Record<string, { id: string; title: string; object_type: CrmRecord["object_type"] }[]>> {
  if (!ids.length) return {};
  const db = getSupabase();
  const [outbound, inbound] = await Promise.all([
    db.from("crm_links").select("from_id,to_id").in("from_id", ids).limit(1000),
    db.from("crm_links").select("from_id,to_id").in("to_id", ids).limit(1000),
  ]);
  if (outbound.error || inbound.error) throw new Error("Associations unavailable");
  const pairs: [string, string][] = [
    ...((outbound.data ?? []) as { from_id: string; to_id: string }[]).map(link => [link.from_id, link.to_id] as [string, string]),
    ...((inbound.data ?? []) as { from_id: string; to_id: string }[]).map(link => [link.to_id, link.from_id] as [string, string]),
  ];
  const others = [...new Set(pairs.map(([, other]) => other))];
  if (!others.length) return {};
  const records = await db.from("crm_records").select("id,title,object_type,local_fields").in("id", others.slice(0, 1000)).in("object_type", ["contacts", "companies"]).eq("archived", false);
  if (records.error) throw new Error("Associations unavailable");
  const byId = new Map(((records.data ?? []) as CrmRecord[]).map(record => [record.id, { id: record.id, title: record.local_fields?.title || record.title, object_type: record.object_type }]));
  const result: Record<string, { id: string; title: string; object_type: CrmRecord["object_type"] }[]> = {};
  for (const [id, other] of pairs) {
    const label = byId.get(other);
    if (!label) continue;
    const list = result[id] ??= [];
    if (!list.some(item => item.id === label.id)) list.push(label);
  }
  // Contacts first, then companies; a short list keeps rows readable.
  const rank = (type: string) => type === "contacts" ? 0 : 1;
  for (const id of Object.keys(result)) result[id] = result[id].sort((a, b) => rank(a.object_type) - rank(b.object_type) || a.title.localeCompare(b.title)).slice(0, 3);
  return result;
}

/** Follow-up summary for one contact or company. Null while it is still being indexed. */
export async function followupSummary(id: string) {
  const result = await getSupabase().from("crm_directory").select(`id,${FOLLOWUP_COLUMNS}`).eq("id", id).maybeSingle();
  if (result.error) throw new Error("Follow-up summary unavailable");
  return (result.data as Pick<CrmRecord, "last_contacted_at" | "next_task_id" | "next_task_title" | "next_task_due_at" | "open_task_count" | "followup_checked_at"> | null) ?? null;
}

/** The pinned activity for a record, or null. A missing table means no pin
 * yet, and a pin whose link was later removed is not shown. */
export async function pinnedActivity(id: string): Promise<CrmRecord | null> {
  const db = getSupabase();
  const pin = await db.from("crm_pins").select("activity_id").eq("record_id", id).maybeSingle();
  if (pin.error || !pin.data) return null;
  const activity = (pin.data as { activity_id: string }).activity_id;
  const [record, outbound, inbound] = await Promise.all([
    db.from("crm_records").select(SUMMARY_COLUMNS).eq("id", activity).eq("archived", false).maybeSingle(),
    db.from("crm_links").select("from_id").eq("from_id", id).eq("to_id", activity).limit(1),
    db.from("crm_links").select("from_id").eq("from_id", activity).eq("to_id", id).limit(1),
  ]);
  if (record.error || outbound.error || inbound.error) throw new Error("Pinned activity unavailable");
  if (!outbound.data?.length && !inbound.data?.length) return null;
  return record.data ? effectiveRecord(record.data as unknown as CrmRecord) : null;
}
