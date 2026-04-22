import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { sendSurveys } from "@/lib/employee-surveys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const employeeId = req.nextUrl.searchParams.get("employee_id");
  const weekOf = req.nextUrl.searchParams.get("week_of");

  let query = getSupabase()
    .from("employee_surveys")
    .select("*, employees(name)")
    .order("week_of", { ascending: false })
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (weekOf) query = query.eq("week_of", weekOf);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ surveys: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action");
  if (action !== "send")
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const result = await sendSurveys();
  return NextResponse.json(result);
}
