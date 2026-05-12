import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

interface TodoRow {
  id: string;
  title: string;
  completed: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  due_at: string | null;
}

function normalizeDueDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Expect YYYY-MM-DD from the date input — accept anything Postgres can cast,
  // but cheap-validate to keep junk out.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

async function buildNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await getSupabase()
      .from("employees")
      .select("email, name")
      .not("email", "is", null);
    for (const e of (data ?? []) as { email: string; name: string }[]) {
      if (e.email) map.set(e.email.toLowerCase(), e.name);
    }
  } catch {
    // employees table / email column may not exist — fall back to email-only display.
  }
  return map;
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const myEmail = user.email.toLowerCase();
  const scope = req.nextUrl.searchParams.get("scope") ?? "mine";

  let query = getSupabase()
    .from("todos")
    .select("*")
    .order("completed", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);

  if (scope === "all") {
    if (!(await isManagementUser())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // No created_by filter — managers see everyone.
  } else {
    query = query.eq("created_by", myEmail);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nameMap = await buildNameMap();
  const enriched = ((data ?? []) as TodoRow[]).map((t) => ({
    ...t,
    created_by_name: nameMap.get(t.created_by.toLowerCase()) ?? t.created_by,
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, due_at } = body as { title?: string; due_at?: string };

  if (!title || typeof title !== "string" || !title.trim())
    return NextResponse.json({ error: "title is required" }, { status: 400 });

  const ownerEmail = user.email.toLowerCase();

  const { data, error } = await getSupabase()
    .from("todos")
    .insert({
      title: title.trim(),
      created_by: ownerEmail,
      due_at: normalizeDueDate(due_at),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nameMap = await buildNameMap();
  return NextResponse.json(
    {
      ...data,
      created_by_name: nameMap.get(ownerEmail) ?? ownerEmail,
    },
    { status: 201 },
  );
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, completed, due_at } = body as {
    id?: string;
    completed?: boolean;
    // due_at semantics: string "YYYY-MM-DD" sets it, empty string / null clears it,
    // undefined leaves it alone (so a pure completion toggle doesn't wipe the date).
    due_at?: string | null;
  };

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (completed !== undefined && typeof completed !== "boolean")
    return NextResponse.json({ error: "completed must be boolean" }, { status: 400 });
  if (completed === undefined && due_at === undefined)
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const supabase = getSupabase();
  const myEmail = user.email.toLowerCase();

  const { data: existing, error: fetchErr } = await supabase
    .from("todos")
    .select("created_by")
    .eq("id", id)
    .single();
  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const owner = (existing.created_by as string).toLowerCase();
  if (owner !== myEmail && !(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (completed !== undefined) updates.completed = completed;
  if (due_at !== undefined) updates.due_at = due_at === null || due_at === "" ? null : normalizeDueDate(due_at);

  const { data, error } = await supabase
    .from("todos")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const myEmail = user.email.toLowerCase();

  const { data: existing, error: fetchErr } = await supabase
    .from("todos")
    .select("created_by")
    .eq("id", id)
    .single();
  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const owner = (existing.created_by as string).toLowerCase();
  if (owner !== myEmail && !(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
