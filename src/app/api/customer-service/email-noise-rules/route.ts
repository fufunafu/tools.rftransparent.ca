import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("email_noise_rules")
    .select("id, rule_type, value, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rule_type, value } = await req.json() as { rule_type: string; value: string };
  if (!rule_type || !value)
    return NextResponse.json({ error: "rule_type and value required" }, { status: 400 });
  if (rule_type !== "prefix" && rule_type !== "domain")
    return NextResponse.json({ error: "rule_type must be prefix or domain" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("email_noise_rules")
    .insert({ rule_type, value: value.toLowerCase().trim() })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") // unique violation
      return NextResponse.json({ error: "Rule already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rule: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await getSupabase().from("email_noise_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "deleted" });
}
