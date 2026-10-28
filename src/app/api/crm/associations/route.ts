import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { CrmInputError, crmId } from "@/lib/crm/input";
import { associationLabels, followupSummary, pinnedActivity, recordAssociations } from "@/lib/crm/search";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Read-only relationship lookups. Changes go through /api/crm/actions.
//   ?ids=a,b,c      first linked contacts/companies for up to 50 list rows
//   ?record=id      every linked contact/company, with whether Tools can remove it
//   ?summary=id     last contacted, next task and open task count
//   ?pin=id         the activity pinned to a record
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const one = (key: string) => { const parsed = crmId.safeParse(params.get(key)); if (!parsed.success) throw new CrmInputError("Invalid record"); return parsed.data; };
    if (params.has("ids")) {
      const ids = [...new Set((params.get("ids") ?? "").split(",").filter(Boolean))];
      if (ids.length > 50 || ids.some(id => !crmId.safeParse(id).success)) throw new CrmInputError("Invalid records");
      return json({ labels: await associationLabels(ids) });
    }
    if (params.has("record")) return json({ records: await recordAssociations(one("record")) });
    if (params.has("summary")) return json({ summary: await followupSummary(one("summary")) });
    if (params.has("pin")) return json({ pinned: await pinnedActivity(one("pin")) });
    throw new CrmInputError("Choose what to look up");
  } catch (error) {
    return error instanceof CrmInputError ? json({ error: error.message }, error.status) : json({ error: "Associations are temporarily unavailable." }, 503);
  }
}
