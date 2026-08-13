import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  isManagementUser,
  isRestrictedSurveyManager,
} from "@/lib/admin-auth";
import {
  createTargetedSurveyCampaign,
  sendSurveys,
} from "@/lib/employee-surveys";
import { loadSurveyDashboardReport } from "@/lib/survey-reporting";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const report = await loadSurveyDashboardReport(await isRestrictedSurveyManager());
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[survey-reporting] dashboard load failed", error);
    return NextResponse.json({ error: "Could not load survey reporting" }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const action = request.nextUrl.searchParams.get("action");
  try {
    if (action === "send") {
      return NextResponse.json(await sendSurveys());
    }
    if (action === "targeted") {
      const user = await getAuthenticatedUser();
      const body = await request.json() as Record<string, unknown>;
      const result = await createTargetedSurveyCampaign({
        name: typeof body.name === "string" ? body.name : "",
        purpose: typeof body.purpose === "string" ? body.purpose : "",
        decisionSupported: typeof body.decision_supported === "string" ? body.decision_supported : "",
        department: typeof body.department === "string" && body.department ? body.department : null,
        locationId: typeof body.location_id === "string" && body.location_id ? body.location_id : null,
        employeeIds: Array.isArray(body.employee_ids)
          ? body.employee_ids.filter((value): value is string => typeof value === "string")
          : undefined,
        createdBy: user?.email ?? "management",
      });
      return NextResponse.json(result, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Survey action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
