import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { isProblemType } from "@/lib/problem-tickets";

const COLUMNS =
  "id, client_name, ticket_date, person, status, type, issue, resolution, store, created_by, created_at, updated_at, resolved_at";

function todayToronto(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("problem_tickets")
    .select(COLUMNS)
    .order("ticket_date", { ascending: false })
    .order("created_at", { ascending: false })
    // PostgREST caps a response at 1000 rows silently, so asking for more just
    // hides the truncation. Page with .range() if this table ever grows past it.
    .limit(1000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tickets: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const clientName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  if (!clientName)
    return NextResponse.json({ error: "Client name is required" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("problem_tickets")
    .insert({
      client_name: clientName,
      ticket_date: isISODate(body.ticket_date) ? body.ticket_date : todayToronto(),
      person: optionalText(body.person),
      type: isProblemType(body.type) ? body.type : "other",
      issue: optionalText(body.issue),
      store: optionalText(body.store),
      created_by: user.email,
    })
    .select(COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ticket: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: current, error: fetchError } = await supabase
    .from("problem_tickets")
    .select("status, resolved_at")
    .eq("id", id)
    .single();
  if (fetchError)
    return NextResponse.json({ error: fetchError.message }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.client_name === "string" && body.client_name.trim())
    updates.client_name = body.client_name.trim();
  if (isISODate(body.ticket_date)) updates.ticket_date = body.ticket_date;
  if ("person" in body) updates.person = optionalText(body.person);
  if (isProblemType(body.type)) updates.type = body.type;
  if ("issue" in body) updates.issue = optionalText(body.issue);
  if ("resolution" in body) updates.resolution = optionalText(body.resolution);
  if ("store" in body) updates.store = optionalText(body.store);

  if (body.status === "resolved" || body.status === "in_progress") {
    updates.status = body.status;
    if (body.status === "resolved" && current.status !== "resolved") {
      updates.resolved_at = new Date().toISOString();
    } else if (body.status === "in_progress") {
      updates.resolved_at = null;
    }
  }

  const { data, error } = await supabase
    .from("problem_tickets")
    .update(updates)
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ticket: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await getSupabase().from("problem_tickets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
