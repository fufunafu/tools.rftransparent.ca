import { NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { getSupabase } from "@/lib/supabase";
import { CrmInputError, readCrmJson } from "@/lib/crm/input";
import { crmAction, databaseError } from "@/lib/crm/productivity";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Edits, deletes, pins and associations. Attribution and management rights
// always come from the session, never from the request body.
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try {
    const parsed = crmAction.safeParse(await readCrmJson(request));
    if (!parsed.success) return json({ error: "Check the entered details and try again." }, 400);
    const v = parsed.data, actor = user.email.toLowerCase(), db = getSupabase();
    const canManage = await isManagementUser();
    const call = (fn: string, args: Record<string, unknown>, fallback: string) => db.rpc(fn, args).then(result => {
      if (result.error) { const failure = databaseError(result.error, fallback); throw new CrmInputError(failure.message, failure.status); }
      return result.data;
    });
    if (v.action === "editActivity") {
      const version = await call("crm_edit_activity", { p_id: v.id, p_version: v.version, p_title: v.title, p_body: v.body, p_occurred_at: v.occurredAt, p_details: v.details, p_actor: actor, p_can_manage: canManage }, "Activity changed or is unavailable. Refresh before saving.");
      return json({ saved: true, version });
    }
    if (v.action === "editTask") {
      const version = await call("crm_update_task_details", { p_id: v.id, p_version: v.version, p_title: v.title, p_body: v.body, p_owner: v.ownerEmail ?? null, p_details: v.details, p_actor: actor, p_can_manage: canManage }, "Task changed or is unavailable. Refresh before saving.");
      return json({ saved: true, version });
    }
    if (v.action === "delete" || v.action === "restore") {
      const version = await call("crm_set_deleted", { p_id: v.id, p_version: v.version, p_deleted: v.action === "delete", p_actor: actor, p_can_manage: canManage }, "Record changed or is unavailable. Refresh and try again.");
      return json({ saved: true, version });
    }
    if (v.action === "pin") {
      const pinned = await call("crm_pin_activity", { p_record: v.recordId, p_activity: v.activityId, p_actor: actor }, "Could not update the pinned activity. Refresh and try again.");
      return json({ pinned });
    }
    if (v.action === "link") {
      const added = await call("crm_link_records", { p_from: v.fromId, p_to: v.toId, p_actor: actor }, "Could not add the association. Refresh and try again.");
      return json({ added });
    }
    if (v.action === "unlink") {
      const removed = await call("crm_unlink_records", { p_from: v.fromId, p_to: v.toId, p_actor: actor }, "Could not remove the association. Refresh and try again.");
      return json({ removed });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return error instanceof CrmInputError ? json({ error: error.message }, error.status) : json({ error: "CRM is temporarily unavailable." }, 503);
  }
}
