import { NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getCrmRecord, getCrmStatus, listCrmRecords } from "@/lib/crm/data";
import { CrmInputError, createCrmRecord, readCrmJson, updateCrmTask, editCrmContact } from "@/lib/crm/input";
import { canAccessCrm } from "@/lib/crm/access";
import { CRM_RECORD_VIEWS, type CrmRecordView } from "@/lib/crm/types";
import { getCrmDirectoryOptions } from "@/lib/crm/directory-data";
import { directoryEdit } from "@/lib/crm/directory-workflows";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const fail = (error: unknown) => json({ error: error instanceof CrmInputError ? error.message : "CRM is temporarily unavailable. Check the connection and database setup." }, error instanceof CrmInputError ? error.status : 503);

// Some historical emails exceed a buffered function response's size limit.
// Stream the complete JSON without truncating original fields or history.
function recordJson(body: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  }), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("statusOnly") === "true") return json(await getCrmStatus());
    if (params.get("filtersOnly") === "true") return json(await getCrmDirectoryOptions(params));
    if (params.has("id")) {
      const view = (params.get("view") ?? "full") as CrmRecordView;
      if (!CRM_RECORD_VIEWS.includes(view)) throw new CrmInputError("Invalid record view");
      return recordJson(await getCrmRecord(params.get("id")!, view));
    }
    return json(await listCrmRecords(params, user.email.toLowerCase()));
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try {
    const parsed = createCrmRecord.safeParse(await readCrmJson(request));
    if (!parsed.success) return json({ error: "Enter a title, valid activity date, and a due date for tasks." }, 400);
    const v = parsed.data;
    if (v.relatedId) await getCrmRecord(v.relatedId, "summary");
    const result = await getSupabase().rpc("crm_create_record", {
      p_id: v.requestId, p_type: v.type, p_title: v.title, p_body: v.body,
      p_properties: { email: v.email, phone: v.phone, company: v.company, ...(v.type === "tasks" ? { reminder_enabled: v.reminderEnabled, reminder_minutes: v.reminderMinutes } : {}) },
      p_occurred_at: v.occurredAt, p_due_at: v.type === "tasks" ? v.dueAt : null,
      p_related_id: v.relatedId, p_actor: user.email.toLowerCase(),
    });
    if (result.error) throw new CrmInputError("Could not save. Check the related record and try again.", 409);
    return json({ id: result.data }, 201);
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try {
    const input = await readCrmJson(request);
    if (typeof input === "object" && input && "action" in input && input.action === "editRecord") {
      const edit = directoryEdit.safeParse(input);
      if (!edit.success) return json({ error: "Enter a name, valid email addresses, and valid website details." }, 400);
      const result = await getSupabase().rpc("crm_edit_directory_record", {
        p_id: edit.data.id, p_version: edit.data.version, p_fields: edit.data.fields,
        p_company_id: edit.data.companyId, p_actor: user.email.toLowerCase(),
      });
      if (result.error) return json({ error: "Record or company changed or is unavailable. Refresh before saving." }, 409);
      return json({ saved: true, version: result.data });
    }
    if (typeof input === "object" && input && "action" in input && input.action === "editContact") {
      const edit = editCrmContact.safeParse(input);
      if (!edit.success) return json({ error: "Enter a name and valid contact details." }, 400);
      const result = await getSupabase().rpc("crm_edit_contact", { p_id: edit.data.id, p_version: edit.data.version, p_fields: edit.data.fields, p_actor: user.email.toLowerCase() });
      if (result.error) return json({ error: "Contact changed or is unavailable. Refresh before saving." }, 409);
      return json({ saved: true, version: result.data });
    }
    const parsed = updateCrmTask.safeParse(input);
    if (!parsed.success) return json({ error: "Choose a status and valid due date." }, 400);
    const v = parsed.data;
    const record = await getCrmRecord(v.id, "summary");
    const canManage = await isManagementUser();
    if (record.owner_email !== user.email.toLowerCase() && !canManage) return json({ error: "Only the task owner or management may update this task." }, 403);
    const result = await getSupabase().rpc(v.reminderEnabled === undefined ? "crm_update_task" : "crm_update_task_settings", { p_id: v.id, p_version: v.version, p_status: v.status, p_due_at: v.dueAt, p_actor: user.email.toLowerCase(), p_can_manage: canManage,
      ...(v.reminderEnabled === undefined ? {} : { p_reminder_enabled: v.reminderEnabled, p_reminder_minutes: v.reminderMinutes }) });
    if (result.error) return json({ error: "Task changed or is unavailable. Refresh before saving." }, 409);
    return json({ saved: true, version: result.data });
  } catch (error) { return fail(error); }
}
