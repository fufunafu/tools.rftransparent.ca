import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

// Lightweight open-ticket count for the sidebar badge — head-only query so
// the sidebar isn't downloading the full ticket list on every page.
export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count, error } = await getSupabase()
    .from("problem_tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "in_progress");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ open: count ?? 0 });
}
