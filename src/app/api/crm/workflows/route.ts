import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { CrmInputError, crmId, readCrmJson } from "@/lib/crm/input";
import { getSupabase } from "@/lib/supabase";
import { captureContent, type CaptureEvent } from "@/lib/crm/capture";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review_duplicate"), kind: z.enum(["email", "phone"]), value: z.string().min(3).max(320), fingerprint: z.string().regex(/^[0-9a-f]{32}$/), decision: z.enum(["duplicate", "separate", "reopen"]) }),
  z.object({ action: z.literal("review_activity"), id: z.string().uuid(), version: z.number().int().positive(), contactId: crmId.nullable() }),
  z.object({ action: z.literal("retry_files") }),
]);
async function authorize() {
  const user = await getAuthenticatedUser();
  if (!user?.email) throw new CrmInputError("Unauthorized", 401);
  if (!(await canAccessCrm())) throw new CrmInputError("CRM access required", 403);
  return user.email.toLowerCase();
}
function fail(error: unknown) { return json({ error: error instanceof CrmInputError ? error.message : "CRM workflows are temporarily unavailable." }, error instanceof CrmInputError ? error.status : 503); }

export async function GET(request: Request) {
  try {
    const email = await authorize();
    const params = new URL(request.url).searchParams;
    const mode = params.get("view") ?? "status";
    const page = Number(params.get("page") ?? 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 3000) throw new CrmInputError("Invalid page");
    const db = getSupabase();
    if (mode === "status") {
      const [result, latest] = await Promise.all([
        db.rpc("crm_workflow_status"),
        db.from("cron_runs").select("started_at,finished_at,status").eq("job", "crm-workflows").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (result.error) throw new Error("Unavailable");
      return json({ ...result.data, remindersConfigured: Boolean(process.env.RESEND_API_KEY), filesConfigured: Boolean(process.env.HUBSPOT_ACCESS_TOKEN), latestRun: latest.data ?? null });
    }
    if (mode === "duplicates") {
      const result = await db.rpc("crm_duplicate_groups", { p_reviewed: params.get("reviewed") === "true", p_offset: page * 30 });
      if (result.error) throw new Error("Unavailable");
      return json({ groups: result.data ?? [], page });
    }
    if (mode === "activity") {
      const result = await db.from("crm_capture_events").select("id,revision,kind,occurred_at,reason,payload,matched_ids", { count: "exact" }).eq("status", "review").order("occurred_at", { ascending: false }).order("id").range(page * 30, page * 30 + 29);
      if (result.error) throw new Error("Unavailable");
      const ids = [...new Set((result.data ?? []).flatMap(row => row.matched_ids as string[]))];
      const contacts = ids.length ? await db.from("crm_records").select("id,title,summary").in("id", ids).eq("archived", false) : { data: [], error: null };
      if (contacts.error) throw new Error("Unavailable");
      return json({ events: (result.data ?? []).map(row => ({ ...row, candidates: (contacts.data ?? []).filter(contact => row.matched_ids.includes(contact.id)) })), total: result.count ?? 0, page });
    }
    if (mode === "reminders") {
      const [tasks, deliveries] = await Promise.all([
        db.from("crm_records").select("id,title,effective_due_at,reminder_enabled,reminder_minutes").eq("object_type", "tasks").eq("owner_email", email).eq("archived", false).eq("effective_task_status", "open").eq("reminder_enabled", true).order("effective_due_at").range(page * 30, page * 30 + 29),
        db.from("crm_reminder_deliveries").select("id,record_id,title,kind,status,error_code,sent_at,created_at").eq("owner_email", email).order("created_at", { ascending: false }).limit(15),
      ]);
      if (tasks.error || deliveries.error) throw new Error("Unavailable");
      return json({ tasks: tasks.data ?? [], deliveries: deliveries.data ?? [], page });
    }
    if (mode === "files") {
      const recordId = params.get("record");
      if (recordId && !crmId.safeParse(recordId).success) throw new CrmInputError("Invalid record");
      let query = recordId
        ? db.rpc("crm_assets_for_record", { p_id: recordId }, { count: "exact" })
        : db.from("crm_assets").select("id,kind,filename,status,byte_size,error_code,copied_at", { count: "exact" });
      const status = params.get("status");
      if (status && !["pending", "copying", "ready", "blocked", "failed"].includes(status)) throw new CrmInputError("Invalid file status");
      if (status) query = query.eq("status", status);
      const result = await query.order("id").range(page * 30, page * 30 + 29);
      if (result.error) throw new Error("Unavailable");
      return json({ files: result.data ?? [], total: result.count ?? 0, page });
    }
    throw new CrmInputError("Unknown view");
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const email = await authorize();
    const parsed = mutation.safeParse(await readCrmJson(request));
    if (!parsed.success) throw new CrmInputError("Invalid workflow action");
    const v = parsed.data;
    const db = getSupabase();
    if (v.action === "review_duplicate") {
      const result = await db.rpc("crm_review_duplicate", { p_kind: v.kind, p_value: v.value, p_fingerprint: v.fingerprint, p_decision: v.decision, p_actor: email });
      if (result.error) throw new CrmInputError("This group changed. Refresh before reviewing.", 409);
    } else if (v.action === "review_activity") {
      const event = await db.from("crm_capture_events").select("*").eq("id", v.id).eq("status", "review").maybeSingle();
      if (event.error || !event.data) throw new CrmInputError("Activity is no longer awaiting review.", 409);
      const result = await db.rpc("crm_finish_capture", { p_id: v.id, p_token: null, p_revision: v.version, p_actor: email,
        p_result: { status: v.contactId ? "captured" : "ignored", reason: v.contactId ? "staff_review" : "staff_ignored", contact_id: v.contactId, matched_ids: event.data.matched_ids, ...captureContent(event.data as CaptureEvent) } });
      if (result.error) throw new CrmInputError("Activity or customer changed. Refresh before saving.", 409);
    } else {
      if (!(await isManagementUser())) throw new CrmInputError("Management access required", 403);
      if (!process.env.HUBSPOT_ACCESS_TOKEN) throw new CrmInputError("Configure HubSpot file access before retrying.", 409);
      const result = await db.from("crm_assets").update({ status: "pending", attempts: 0, error_code: null, retry_at: null }).in("status", ["blocked", "failed"]);
      if (result.error) throw new Error("Unavailable");
    }
    return json({ saved: true });
  } catch (error) { return fail(error); }
}
