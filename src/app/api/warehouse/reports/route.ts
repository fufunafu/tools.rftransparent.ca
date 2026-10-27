import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import { getSupabase } from "@/lib/supabase";
import { validateWarehouseReport } from "@/lib/warehouse-report";

const NO_STORE = { "Cache-Control": "private, no-store" };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

// Personal reports belong to warehouse staff. Management may also file and
// read their own report so the Daily Report page is never a dead end for them.
async function reportingEmployee(email: string) {
  const employee = await findActiveEmployeeByEmail(email);
  if (!employee) return null;
  if (employee.department === "warehouse") return employee;
  return (await isManagementUser()) ? employee : null;
}

// The warehouse floor shares one station, so the form has a name selector
// (restored 2026-09-02 on owner request, reverting the Aug 20 lockdown).
// A selected identity must still be a real, active warehouse employee.
async function resolveSelectedEmployee(
  sessionEmployeeId: string,
  requestedId: string | null,
): Promise<string | null> {
  if (!requestedId || requestedId === sessionEmployeeId) return sessionEmployeeId;
  const { data } = await getSupabase()
    .from("employees")
    .select("id")
    .eq("id", requestedId)
    .eq("department", "warehouse")
    .eq("active", true)
    .maybeSingle();
  return data ? data.id : null;
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return jsonError("Unauthorized", 401);

  const { searchParams } = req.nextUrl;
  const scope = searchParams.get("scope") ?? "mine";
  const employeeId = searchParams.get("employeeId");
  let scopedEmployeeId: string | null = null;

  if (scope === "all") {
    if (!(await isManagementUser())) return jsonError("Forbidden", 403);
    scopedEmployeeId = employeeId;
  } else {
    const employee = await reportingEmployee(user.email);
    if (!employee) {
      return jsonError("Your login is not linked to an active warehouse employee", 403);
    }
    scopedEmployeeId = await resolveSelectedEmployee(employee.id, employeeId);
    if (!scopedEmployeeId) {
      return jsonError("That name is not an active warehouse employee", 400);
    }
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  let query = getSupabase()
    .from("warehouse_daily_reports")
    .select("*, employees(id, name)")
    .order("report_date", { ascending: false });

  if (from) query = query.gte("report_date", from);
  if (to) query = query.lte("report_date", to);
  if (scopedEmployeeId) query = query.eq("employee_id", scopedEmployeeId);

  const { data, error } = await query.limit(500);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json(data, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return jsonError("Unauthorized", 401);

  const employee = await reportingEmployee(user.email);
  if (!employee) {
    return jsonError("Your login is not linked to an active warehouse employee", 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }
  const parsed = validateWarehouseReport(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const { value } = parsed;
  const targetEmployeeId = await resolveSelectedEmployee(employee.id, value.employeeId);
  if (!targetEmployeeId) {
    return jsonError("That name is not an active warehouse employee", 400);
  }
  const { data, error } = await getSupabase()
    .from("warehouse_daily_reports")
    .upsert(
      {
        employee_id: targetEmployeeId,
        report_date: value.reportDate,
        boxes_built: value.boxesBuilt,
        orders_packed: value.ordersPacked,
        walkin_pickup: value.walkinPickup,
        notes: value.notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,report_date" },
    )
    .select("*, employees(id, name)")
    .single();

  if (error) return jsonError(error.message, 500);
  return NextResponse.json(data, { status: 201, headers: NO_STORE });
}
