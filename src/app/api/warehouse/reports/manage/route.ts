import { NextRequest, NextResponse } from "next/server";
import { isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { validateWarehouseReport } from "@/lib/warehouse-report";

export async function POST(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const managerBody = body as Record<string, unknown>;
  const employeeId = managerBody.employee_id;
  if (typeof employeeId !== "string" || !employeeId.trim()) {
    return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  }
  const parsed = validateWarehouseReport(
    Object.fromEntries(
      Object.entries(managerBody).filter(([key]) => key !== "employee_id"),
    ),
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const employee = await getSupabase()
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("department", "warehouse")
    .eq("active", true)
    .maybeSingle();
  if (employee.error) {
    return NextResponse.json({ error: employee.error.message }, { status: 500 });
  }
  if (!employee.data) {
    return NextResponse.json({ error: "Warehouse employee not found" }, { status: 404 });
  }

  const { value } = parsed;
  const result = await getSupabase()
    .from("warehouse_daily_reports")
    .upsert(
      {
        employee_id: employeeId,
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

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json(result.data, { status: 201 });
}
