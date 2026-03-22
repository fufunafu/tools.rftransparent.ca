import { NextResponse } from "next/server";
import { isEmployeeAuthenticated } from "@/lib/employee-auth";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  if (!(await isEmployeeAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: employees, error } = await getSupabase()
    .from("employees")
    .select("id, name, department, location_id, locations(id, name)")
    .eq("active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ employees: employees ?? [] });
}
