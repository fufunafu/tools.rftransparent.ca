import "server-only";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";
import { CRM_TYPES, CRM_RECORD_VIEWS, type CrmPage, type CrmRecord, type CrmRecordView, type CrmStatus } from "./types";
import { CrmInputError, crmId } from "./input";
import { unpackProperties } from "./storage.mjs";

const SUMMARY_COLUMNS = "id,object_type,source,portal_id,hubspot_id,title,summary,owner_email,occurred_at,effective_due_at,effective_task_status,archived,version,created_by_email";

export async function listCrmRecords(params: URLSearchParams, email: string): Promise<CrmPage> {
  const page = Number(params.get("page") ?? 0);
  const type = params.get("type") ?? "contacts";
  const search = params.get("q")?.trim() ?? "";
  const related = params.get("related");
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000 || search.length > 200 || (type !== "activities" && type !== "all" && !CRM_TYPES.includes(type as never))) throw new CrmInputError("Invalid search");
  if (related && !crmId.safeParse(related).success) throw new CrmInputError("Invalid record");
  const db = getSupabase();
  let query = related
    ? db.rpc("crm_related_records", { p_id: related }, { count: "exact" }).select(SUMMARY_COLUMNS)
    : db.from("crm_records").select(SUMMARY_COLUMNS, { count: "exact" });
  if (type === "activities") query = query.in("object_type", ["calls", "meetings", "emails", "notes", "tasks"]);
  else if (type !== "all") query = query.eq("object_type", type);
  query = query.eq("archived", params.get("archived") === "true");
  if (search) {
    const value = quotePostgrestValue(`%${search.replace(/[%_\\]/g, "\\$&")}%`);
    query = query.or(`title.ilike.${value},summary.ilike.${value},search_document.wfts(simple).${quotePostgrestValue(search)}`);
  }
  if (params.get("mine") === "true") query = query.eq("owner_email", email);
  if (type === "tasks") {
    const status = params.get("status") ?? "open";
    if (!["open", "completed", "all"].includes(status)) throw new CrmInputError("Invalid task status");
    if (status !== "all") query = query.eq("effective_task_status", status);
    if (params.get("overdue") === "true") query = query.lt("effective_due_at", new Date().toISOString()).eq("effective_task_status", "open");
    query = query.order("effective_due_at", { ascending: true, nullsFirst: false });
  } else query = query.order("occurred_at", { ascending: false, nullsFirst: false });
  const result = await query.order("id").range(page * 50, page * 50 + 49);
  if (result.error) throw new Error("CRM search unavailable");
  return { records: result.data as unknown as CrmRecord[], total: result.count ?? 0, page };
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
  return record;
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
