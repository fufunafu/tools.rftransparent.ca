import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("todos")
    .select("*")
    .order("completed", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, created_by } = body;

  if (!title || typeof title !== "string" || !title.trim())
    return NextResponse.json(
      { error: "title is required" },
      { status: 400 }
    );

  const { data, error } = await getSupabase()
    .from("todos")
    .insert({
      title: title.trim(),
      created_by: (created_by ?? "").trim() || "Anonymous",
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, completed } = body;

  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (typeof completed !== "boolean")
    return NextResponse.json(
      { error: "completed (boolean) is required" },
      { status: 400 }
    );

  const { data, error } = await getSupabase()
    .from("todos")
    .update({ completed, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await getSupabase()
    .from("todos")
    .delete()
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
