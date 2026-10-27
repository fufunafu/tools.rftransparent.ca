import "server-only";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";
import { CRM_TYPES, CRM_RECORD_VIEWS, type CrmPage, type CrmRecord, type CrmRecordView, type CrmStatus } from "./types";
import { CrmInputError, crmId } from "./input";
import { unpackProperties } from "./storage.mjs";
import { DIRECTORY_FIELDS } from "./directory";
import { readDirectoryFilters } from "./directory-data";

export const SUMMARY_COLUMNS = "id,object_type,source,portal_id,hubspot_id,title,summary,owner_email,occurred_at,effective_due_at,effective_task_status,archived,version,created_by_email,reminder_enabled,reminder_minutes,view_fields,local_fields";

export async function listCrmRecords(params: URLSearchParams, email: string): Promise<CrmPage> {
  const page = Number(params.get("page") ?? 0);
  const type = params.get("type") ?? "contacts";
  const search = params.get("q")?.trim() ?? "";
  const related = params.get("related");
  const view = params.get("filter") ?? "all";
  const directory = (type === "contacts" || type === "companies") && !related;
  const directoryQuery = directory ? readDirectoryFilters(params) : null;
  if (!directory && [...DIRECTORY_FIELDS, "sort", "source"].some(field => params.has(field))) throw new CrmInputError("Directory filters apply to Contacts and Companies");
  if (!["all", "recent", "upcoming", "overdue", "today"].includes(view)) throw new CrmInputError("Invalid view");
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000 || search.length > 200 || (type !== "relationships" && type !== "activities" && type !== "all" && !CRM_TYPES.includes(type as never))) throw new CrmInputError("Invalid search");
  if (related && !crmId.safeParse(related).success) throw new CrmInputError("Invalid record");
  const db = getSupabase();
  let query = related
    ? db.rpc("crm_related_summaries", { p_id: related, p_search: search }, { count: "exact" }).select(SUMMARY_COLUMNS)
    : db.from(directory ? "crm_directory" : "crm_records").select(SUMMARY_COLUMNS, { count: "exact" });
  if (type === "relationships") query = query.in("object_type", ["contacts", "companies", "deals", "tickets"]);
  else if (type === "activities") query = query.in("object_type", ["calls", "meetings", "emails", "notes", "tasks"]);
  else if (type !== "all") query = query.eq("object_type", type);
  query = query.eq("archived", params.get("archived") === "true");
  if (search && !related) {
    const value = quotePostgrestValue(`%${search.replace(/[%_\\]/g, "\\$&")}%`);
    query = query.or(`title.ilike.${value},summary.ilike.${value},local_fields->>title.ilike.${value},local_fields->>email.ilike.${value},local_fields->>phone.ilike.${value},local_fields->>company.ilike.${value},search_document.wfts(simple).${quotePostgrestValue(search)}`);
  }
  if (params.get("mine") === "true") query = query.eq("owner_email", email);
  if (directoryQuery) {
    for (const field of DIRECTORY_FIELDS) {
      const values = directoryQuery.filters[field];
      // Quote every literal, including blank values and punctuation, before
      // putting it inside PostgREST's filter expression grammar.
      // PostgREST treats in.("") as an empty list, so a lone missing value
      // must use equality. Mixed lists retain their empty-string member.
      if (values.length === 1 && values[0] === "") query = query.eq(`filter_${field}`, "");
      else if (values.length) query = query.filter(`filter_${field}`, "in", `(${values.map(quotePostgrestValue).join(",")})`);
    }
    if (directoryQuery.source) query = query.eq("source", directoryQuery.source);
  }
  if (view === "recent") query = query.gte("occurred_at", new Date(Date.now() - 30 * 86400000).toISOString());
  if (type === "tasks") {
    const status = params.get("status") ?? "open";
    if (!["open", "completed", "all"].includes(status)) throw new CrmInputError("Invalid task status");
    if (status !== "all") query = query.eq("effective_task_status", status);
    if (params.get("overdue") === "true" || view === "overdue") query = query.lt("effective_due_at", new Date().toISOString()).eq("effective_task_status", "open");
    if (view === "upcoming") query = query.gte("effective_due_at", new Date().toISOString()).lt("effective_due_at", new Date(Date.now() + 7 * 86400000).toISOString());
    if (view === "today") {
      const start = params.get("dayStart"), end = params.get("dayEnd");
      if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) - Date.parse(start) > 26 * 3600000 || Date.parse(end) <= Date.parse(start)) throw new CrmInputError("Invalid day");
      query = query.gte("effective_due_at", start).lt("effective_due_at", end);
    }
    query = query.order("effective_due_at", { ascending: view === "upcoming" || view === "today", nullsFirst: false });
  } else if (directoryQuery?.sort.startsWith("name_")) query = query.order("directory_name", { ascending: directoryQuery.sort === "name_asc", nullsFirst: false });
  else query = query.order("occurred_at", { ascending: directoryQuery?.sort === "oldest", nullsFirst: false });
  const result = await query.order("id").range(page * 50, page * 50 + 49);
  if (result.error) throw new Error("CRM search unavailable");
  return { records: (result.data as unknown as CrmRecord[]).map(effectiveRecord), total: result.count ?? 0, page };
}

export async function getCrmRecord(id: string, view: CrmRecordView = "full"): Promise<CrmRecord> {
  if (!crmId.safeParse(id).success) throw new CrmInputError("Invalid record");
  if (!CRM_RECORD_VIEWS.includes(view)) throw new CrmInputError("Invalid record view");
  const columns = [SUMMARY_COLUMNS];
  if (view === "full" || view === "detail") columns.push("body,source_created_at,source_updated_at,imported_at");
  if (view === "full" || view === "fields") columns.push("properties");
  if (view === "full" || view === "history") columns.push("property_history");
  const result = await getSupabase().from("crm_records").select(columns.join(",")).eq("id", id).maybeSingle();
  if (result.error) throw new Error("CRM record unavailable");
  if (!result.data) throw new CrmInputError("Record not found", 404);
  const record = { ...(result.data as unknown as CrmRecord) };
  if (record.properties) record.properties = unpackProperties(record.properties);
  if (record.property_history) record.property_history = unpackProperties(record.property_history);
  return effectiveRecord(record);
}

export async function getCrmStatus(): Promise<CrmStatus> {
  const db = getSupabase();
  const [counts, sync] = await Promise.all([
    db.rpc("crm_counts"),
    db.from("crm_sync_state").select("status,last_error,updated_at,progress").eq("portal_id", process.env.HUBSPOT_PORTAL_ID ?? "40088916").maybeSingle(),
  ]);
  if (counts.error || sync.error) throw new Error("CRM database is not ready");
  return { configured: Boolean(process.env.HUBSPOT_ACCESS_TOKEN && process.env.HUBSPOT_PORTAL_ID), counts: counts.data ?? [], sync: sync.data };
}

export function effectiveRecord(record: CrmRecord): CrmRecord {
  if (!record.local_fields || !Object.keys(record.local_fields).length) return record;
  const fields = { ...record.view_fields, ...record.local_fields };
  if (Object.hasOwn(record.local_fields, "stage") && record.local_fields.stage !== record.view_fields?.stage) delete fields.stage_label;
  return { ...record, title: record.local_fields.title || record.title, view_fields: fields };
}
