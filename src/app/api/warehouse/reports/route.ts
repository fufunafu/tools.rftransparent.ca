import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const employeeId = searchParams.get("employeeId");

  let query = getSupabase()
    .from("warehouse_daily_reports")
    .select("*, employees(id, name)")
    .order("report_date", { ascending: false });

  if (from) query = query.gte("report_date", from);
  if (to) query = query.lte("report_date", to);
  if (employeeId) query = query.eq("employee_id", employeeId);

  const { data, error } = await query.limit(500);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    employee_id,
    report_date,
    boxes_built,
    orders_packed,
    boxes_closed,
    shipments_booked,
    notes,
  } = body;

  if (!employee_id || !report_date)
    return NextResponse.json(
      { error: "employee_id and report_date are required" },
      { status: 400 }
    );

  const { data, error } = await getSupabase()
    .from("warehouse_daily_reports")
    .upsert(
      {
        employee_id,
        report_date,
        boxes_built: boxes_built ?? 0,
        orders_packed: orders_packed ?? 0,
        boxes_closed: boxes_closed ?? 0,
        shipments_booked: shipments_booked ?? 0,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,report_date" }
    )
    .select("*, employees(id, name)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
