import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employeeId = req.nextUrl.searchParams.get("employeeId");
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let query = getSupabase()
    .from("kpi_entries")
    .select("*, employees(id, name, department)")
    .order("date", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data, error } = await query.limit(500);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { employee_id, metric, value, date } = body;

  if (!employee_id || !metric || value == null || !date)
    return NextResponse.json(
      { error: "employee_id, metric, value, and date are required" },
      { status: 400 }
    );

  const { data, error } = await getSupabase()
    .from("kpi_entries")
    .insert({ employee_id, metric, value, date })
    .select("*, employees(id, name, department)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await getSupabase()
    .from("kpi_entries")
    .delete()
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
