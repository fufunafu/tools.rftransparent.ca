import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import { getSupabase } from "@/lib/supabase";
import { validateWarehouseReport } from "@/lib/warehouse-report";

const NO_STORE = { "Cache-Control": "private, no-store" };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
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
    if (employeeId) {
      return jsonError("Employee identity cannot be selected for a personal report", 400);
    }
    const employee = await findActiveEmployeeByEmail(user.email);
    if (!employee || employee.department !== "warehouse") {
      return jsonError("Your login is not linked to an active warehouse employee", 403);
    }
    scopedEmployeeId = employee.id;
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

  const employee = await findActiveEmployeeByEmail(user.email);
  if (!employee || employee.department !== "warehouse") {
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
  const { data, error } = await getSupabase()
    .from("warehouse_daily_reports")
    .upsert(
      {
        employee_id: employee.id,
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
