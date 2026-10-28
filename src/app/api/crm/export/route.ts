import { NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { getSupabase } from "@/lib/supabase";
import { CrmInputError } from "@/lib/crm/input";
import { buildCrmListQuery, effectiveRecord } from "@/lib/crm/data";
import { crmCsv, EXPORT_LIMIT } from "@/lib/crm/export";
import { MIGRATION_MESSAGE } from "@/lib/crm/productivity";
import type { CrmRecord } from "@/lib/crm/types";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const CHUNK = 1000;

// Management-only CSV of the current Contacts or Companies list. Uses the
// exact list filters, refuses rather than truncates above the limit, and
// records who downloaded what before any data is returned.
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  if (!(await isManagementUser())) return json({ error: "Only management can export CRM lists." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const type = params.get("type");
    if (type !== "contacts" && type !== "companies") throw new CrmInputError("Choose Contacts or Companies");
    params.delete("page");
    const email = user.email.toLowerCase();
    const records: CrmRecord[] = [];
    let total = 0;
    // Advance by the rows actually returned, in case the database caps a page.
    do {
      const { query } = buildCrmListQuery(params, email);
      const result = await query.order("id").range(records.length, records.length + CHUNK - 1);
      if (result.error) throw new Error("Export query failed");
      // A different count on a later page means records were added or removed.
      if (records.length && (result.count ?? 0) !== total) throw new CrmInputError("The list changed while exporting. Try the export again.", 409);
      total = result.count ?? 0;
      if (total > EXPORT_LIMIT) throw new CrmInputError(`This list has ${total.toLocaleString("en-CA")} records. Narrow the filters to ${EXPORT_LIMIT.toLocaleString("en-CA")} or fewer to export.`, 413);
      const rows = (result.data ?? []) as unknown as CrmRecord[];
      if (!rows.length) break;
      records.push(...rows.map(effectiveRecord));
    } while (records.length < total);
    // Records added or removed mid-export would make the file incomplete.
    if (records.length !== total) throw new CrmInputError("The list changed while exporting. Try the export again.", 409);
    const filters = Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key)]));
    const logged = await getSupabase().from("crm_exports").insert({ actor_email: email, object_type: type, filters, row_count: records.length });
    if (logged.error) return json({ error: logged.error.code === "PGRST205" ? MIGRATION_MESSAGE : "The export could not be recorded, so it was not downloaded." }, 503);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(crmCsv(records, type), { headers: {
      "Cache-Control": "private, no-store", "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crm-${type}-${stamp}.csv"`,
    } });
  } catch (error) {
    return error instanceof CrmInputError ? json({ error: error.message }, error.status) : json({ error: "Export is temporarily unavailable." }, 503);
  }
}
