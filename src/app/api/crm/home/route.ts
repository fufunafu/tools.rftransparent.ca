import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { getCrmHome } from "@/lib/crm/home";
import { CrmInputError } from "@/lib/crm/input";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try { return json(await getCrmHome(user.email.toLowerCase(), new URL(request.url).searchParams)); }
  catch (error) { return json({ error: error instanceof CrmInputError ? error.message : "Home could not load. Please try again." }, error instanceof CrmInputError ? error.status : 503); }
}
