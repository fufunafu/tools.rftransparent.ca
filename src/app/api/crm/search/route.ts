import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { CrmInputError } from "@/lib/crm/input";
import { findCrmDuplicates, searchCrm } from "@/lib/crm/search";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Global search (?q=) and the duplicate check used while creating a record
// (?duplicates=contacts|companies&name=&email=&phone=).
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try {
    const params = new URL(request.url).searchParams;
    const type = params.get("duplicates");
    if (type !== null) {
      if (type !== "contacts" && type !== "companies") throw new CrmInputError("Choose Contacts or Companies");
      const [name, email, phone] = ["name", "email", "phone"].map(key => params.get(key) ?? "");
      if ([name, email, phone].some(value => value.length > 320)) throw new CrmInputError("Value is too long");
      return json({ matches: await findCrmDuplicates({ type, name, email, phone }) });
    }
    return json(await searchCrm(params.get("q") ?? ""));
  } catch (error) {
    return error instanceof CrmInputError ? json({ error: error.message }, error.status) : json({ error: "CRM search is temporarily unavailable." }, 503);
  }
}
