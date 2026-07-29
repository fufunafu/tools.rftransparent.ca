import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

// The list of systems we track bugs against. Anyone signed in can add one:
// the whole point is that reporting a bug in a system nobody has logged yet
// shouldn't require a developer.

export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("bug_systems")
    .select("id, name")
    .order("name");

  if (error?.code === "PGRST205")
    return NextResponse.json({ systems: [], tableMissing: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ systems: data ?? [], tableMissing: false });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.length > 80)
    return NextResponse.json({ error: "That name is too long" }, { status: 400 });

  const supabase = getSupabase();

  // Case-insensitive match first so "invoicebox" returns the existing
  // "InvoiceBox" rather than tripping the unique index and erroring at
  // someone who did nothing wrong.
  const { data: existing } = await supabase
    .from("bug_systems")
    .select("id, name")
    .ilike("name", name)
    .maybeSingle();
  if (existing) return NextResponse.json({ system: existing, existed: true });

  const { data, error } = await supabase
    .from("bug_systems")
    .insert({ name, created_by: user.email })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ system: data, existed: false });
}
