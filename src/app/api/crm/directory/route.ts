import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { getSupabase } from "@/lib/supabase";
import { CrmInputError, crmId, readCrmJson } from "@/lib/crm/input";
import { bulkDirectoryAction, saveDirectoryView } from "@/lib/crm/directory-workflows";
import { effectiveRecord, SUMMARY_COLUMNS } from "@/lib/crm/data";
import type { CrmRecord } from "@/lib/crm/types";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const fail = (error: unknown) => json({ error: error instanceof CrmInputError ? error.message : "Directory tools are temporarily unavailable." }, error instanceof CrmInputError ? error.status : 503);
async function viewer() {
  const user = await getAuthenticatedUser();
  if (!user?.email) throw new CrmInputError("Unauthorized", 401);
  if (!(await canAccessCrm())) throw new CrmInputError("CRM access required", 403);
  return user.email.toLowerCase();
}
export async function GET(request: Request) {
  try {
    const email = await viewer(), db = getSupabase(), params = new URL(request.url).searchParams;
    if (params.has("history")) {
      const id = crmId.safeParse(params.get("history"));
      const page = Number(params.get("page") ?? "0");
      if (!id.success || !Number.isSafeInteger(page) || page < 0 || page > 10000) throw new CrmInputError("Invalid record history");
      const result = await db.from("crm_audit").select("id,actor_email,action,detail,created_at", { count: "exact" }).eq("record_id", id.data).order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 25, page * 25 + 24);
      if (result.error) throw new Error("History unavailable");
      return json({ entries: result.data ?? [], total: result.count ?? 0, page });
    }
    const type = params.get("type");
    if (type !== "contacts" && type !== "companies") throw new CrmInputError("Choose Contacts or Companies");
    const result = await db.from("crm_saved_views").select("id,name,object_type,config,version").eq("owner_email", email).eq("object_type", type).order("name");
    if (result.error) throw new Error("Views unavailable");
    return json({ views: result.data ?? [] });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const email = await viewer(), input = await readCrmJson(request), db = getSupabase();
    const envelope = z.discriminatedUnion("action", [
      z.object({ action: z.literal("saveView"), view: saveDirectoryView }).strict(),
      z.object({ action: z.literal("previewBulk"), bulk: bulkDirectoryAction }).strict(),
      z.object({ action: z.literal("applyBulk"), bulk: bulkDirectoryAction }).strict(),
    ]).safeParse(input);
    if (!envelope.success) throw new CrmInputError("Check the selected records and entered values.");
    const v = envelope.data;
    if (v.action === "saveView") {
      const result = await db.rpc("crm_save_view", { p_id: v.view.id, p_version: v.view.version, p_type: v.view.type, p_name: v.view.name, p_config: v.view.config, p_actor: email });
      if (result.error) throw new CrmInputError("View changed, name is already used, or the 50-view limit was reached. Refresh and try again.", 409);
      return json({ saved: true, version: result.data });
    }
    if (v.action === "previewBulk") {
      const result = await db.from("crm_records").select(SUMMARY_COLUMNS).in("id", v.bulk.records.map(record => record.id)).eq("object_type", v.bulk.type).eq("archived", false);
      if (result.error) throw new Error("Preview unavailable");
      const records = (result.data ?? []) as unknown as CrmRecord[];
      if (records.length !== v.bulk.records.length || records.some(record => v.bulk.records.find(selected => selected.id === record.id)?.version !== record.version)) throw new CrmInputError("Selected records changed. Refresh the table and select them again.", 409);
      return json({ records: records.map(effectiveRecord), change: v.bulk.change });
    }
    const result = await db.rpc("crm_bulk_directory_action", { p_id: v.bulk.requestId, p_payload: v.bulk, p_actor: email });
    if (result.error) throw new CrmInputError("Selected records changed or the action could not be saved. Refresh before retrying.", 409);
    return json(result.data);
  } catch (error) { return fail(error); }
}
export async function DELETE(request: Request) {
  try {
    const email = await viewer();
    const parsed = z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict().safeParse(await readCrmJson(request));
    if (!parsed.success) throw new CrmInputError("Invalid saved view");
    const result = await getSupabase().from("crm_saved_views").delete().eq("id", parsed.data.id).eq("owner_email", email).eq("version", parsed.data.version).select("id");
    if (result.error) throw new Error("View unavailable");
    if (!result.data?.length) throw new CrmInputError("View changed or unavailable. Refresh and try again.", 409);
    return json({ deleted: true });
  } catch (error) { return fail(error); }
}
