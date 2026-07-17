import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("marketing_analyses")
    .select("id, title, analysis_date, content, created_by, created_at")
    .order("analysis_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ analyses: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const analysisDate =
    typeof body.analysis_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.analysis_date)
      ? body.analysis_date
      : new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

  if (!title || !content)
    return NextResponse.json({ error: "Title and content are required" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("marketing_analyses")
    .insert({ title, content, analysis_date: analysisDate, created_by: user.email })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ analysis: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await getSupabase().from("marketing_analyses").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
