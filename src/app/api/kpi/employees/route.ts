import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isAdminUser } from "@/lib/admin-auth";
import { normalizeOptionalInternationalPhone } from "@/lib/phone";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const department = req.nextUrl.searchParams.get("department");
  const locationId = req.nextUrl.searchParams.get("locationId");
  const activeOnly = req.nextUrl.searchParams.get("active") === "true";

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
  // Employee emails control who can log in (authz allowlist), so creating
  // employees is admin-only.
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, email, email_alt, department, location_id, shopify_tags, commission_rate, active, phone, birthday, hire_date, employment_ended_at, exit_survey_enabled } = body;

  if (!name || !department)
    return NextResponse.json(
      { error: "name and department are required" },
      { status: 400 }
    );

  let normalizedPhone: string | null;
  try {
    normalizedPhone = normalizeOptionalInternationalPhone(phone);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid phone number", field: "phone" },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabase()
    .from("employees")
    .insert({
      name,
      email: email || null,
      email_alt: email_alt || null,
      department,
      location_id: location_id || null,
      shopify_tags: Array.isArray(shopify_tags) ? shopify_tags.filter(Boolean) : [],
      // Fraction of net revenue (0.05 = 5%); clamp to a sane range.
      commission_rate: Math.min(1, Math.max(0, Number(commission_rate) || 0)),
      active: active ?? true,
      phone: normalizedPhone,
      birthday: birthday || null,
      hire_date: hire_date || null,
      employment_ended_at: employment_ended_at || null,
      exit_survey_enabled: exit_survey_enabled !== false,
    })
    .select("*, locations(id, name, shopify_store_ids)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
