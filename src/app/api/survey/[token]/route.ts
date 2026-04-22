import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { data, error } = await getSupabase()
    .from("employee_surveys")
    .select("week_of, responded_at, employees(name)")
    .eq("token", token)
    .single();

  if (error || !data)
    return NextResponse.json({ error: "Survey not found" }, { status: 404 });

  const employee = (Array.isArray(data.employees) ? data.employees[0] : data.employees) as { name: string } | null;
  return NextResponse.json({
    employee_name: employee?.name ?? "Employee",
    week_of: data.week_of,
    already_responded: data.responded_at !== null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: existing, error: fetchError } = await getSupabase()
    .from("employee_surveys")
    .select("id, responded_at")
    .eq("token", token)
    .single();

  if (fetchError || !existing)
    return NextResponse.json({ error: "Survey not found" }, { status: 404 });

  if (existing.responded_at)
    return NextResponse.json({ error: "Already responded" }, { status: 400 });

  const body = await req.json();
  const { satisfaction_score, highlights, complaints, suggestions } = body;

  if (!satisfaction_score || satisfaction_score < 1 || satisfaction_score > 5)
    return NextResponse.json({ error: "satisfaction_score must be 1–5" }, { status: 400 });

  const { error } = await getSupabase()
    .from("employee_surveys")
    .update({
      satisfaction_score,
      highlights: highlights || null,
      complaints: complaints || null,
      suggestions: suggestions || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
