import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, email, email_alt, department, location_id, shopify_tags, active, phone, birthday } = body;

  const { data, error } = await getSupabase()
    .from("employees")
    .update({
      name,
      email: email || null,
      email_alt: email_alt || null,
      department,
      location_id: location_id || null,
      shopify_tags: Array.isArray(shopify_tags) ? shopify_tags.filter(Boolean) : [],
      active,
      phone: phone || null,
      birthday: birthday || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, locations(id, name, shopify_store_ids)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { error } = await getSupabase()
    .from("employees")
    .delete()
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
