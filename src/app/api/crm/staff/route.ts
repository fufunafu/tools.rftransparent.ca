import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { crmStaff } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Names and emails of people who can be assigned CRM work.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  try { return json({ staff: await crmStaff() }); }
  catch { return json({ error: "Staff list is temporarily unavailable." }, 503); }
}
