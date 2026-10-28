import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { getSupabase } from "@/lib/supabase";
import { crmStaff } from "@/lib/crm/staff";
import { databaseError } from "@/lib/crm/productivity";
import type { CrmTeamReport, ReportPerson } from "@/lib/crm/report";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Team activity counts for one period (?start=&end= as ISO timestamps).
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return json({ error: "Unauthorized" }, 401);
  if (!(await canAccessCrm())) return json({ error: "CRM is available to management, sales, and customer service." }, 403);
  const params = new URL(request.url).searchParams;
  const start = Date.parse(params.get("start") ?? ""), end = Date.parse(params.get("end") ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 367 * 86400000) return json({ error: "Choose a period of one year or less." }, 400);
  try {
    const [report, staff] = await Promise.all([
      getSupabase().rpc("crm_team_report", { p_start: new Date(start).toISOString(), p_end: new Date(end).toISOString() }),
      crmStaff().catch(() => []),
    ]);
    if (report.error) { const failure = databaseError(report.error, "Reports are temporarily unavailable."); return json({ error: failure.message }, failure.status === 409 ? 503 : failure.status); }
    const names = new Map(staff.map(person => [person.email, person.name]));
    const data = report.data as { people: Omit<ReportPerson, "name">[]; stages: CrmTeamReport["stages"] };
    const people = data.people.map(person => ({ ...person, name: person.owner ? names.get(person.owner) ?? person.owner : "Unassigned" }));
    return json({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), people, stages: data.stages } satisfies CrmTeamReport);
  } catch { return json({ error: "Reports are temporarily unavailable." }, 503); }
}
