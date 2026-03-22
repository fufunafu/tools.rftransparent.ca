import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const department = req.nextUrl.searchParams.get("department");
  const locationId = req.nextUrl.searchParams.get("locationId");
  const activeOnly = req.nextUrl.searchParams.get("active") !== "false";

  let query = getSupabase()
    .from("employees")
    .select("*, locations(id, name, shopify_store_ids)")
    .order("name");

  if (department) query = query.eq("department", department);
  if (locationId) query = query.eq("location_id", locationId);
  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, department, location_id, shopify_tags, active } = body;

  if (!name || !department)
    return NextResponse.json(
      { error: "name and department are required" },
      { status: 400 }
    );

  const { data, error } = await getSupabase()
    .from("employees")
    .insert({
      name,
      department,
      location_id: location_id || null,
      shopify_tags: Array.isArray(shopify_tags) ? shopify_tags.filter(Boolean) : [],
      active: active ?? true,
    })
    .select("*, locations(id, name, shopify_store_ids)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
