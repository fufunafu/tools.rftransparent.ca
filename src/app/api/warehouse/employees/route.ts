import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isAuthenticated } from "@/lib/admin-auth";

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("employees")
    .select("id, name")
    .eq("department", "warehouse")
    .eq("active", true)
    .order("name");

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
