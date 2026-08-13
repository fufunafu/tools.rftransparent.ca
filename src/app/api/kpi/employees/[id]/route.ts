import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin-auth";
import { normalizeOptionalInternationalPhone } from "@/lib/phone";
import { getSupabase } from "@/lib/supabase";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Employee emails control who can log in (authz allowlist), so editing
  // employees is admin-only.
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { name, email, email_alt, department, location_id, shopify_tags, commission_rate, active, phone, birthday, hire_date, employment_ended_at, exit_survey_enabled } = body;

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
    .update({
      name,
      email: email || null,
      email_alt: email_alt || null,
      department,
      location_id: location_id || null,
      shopify_tags: Array.isArray(shopify_tags) ? shopify_tags.filter(Boolean) : [],
      // Fraction of net revenue (0.05 = 5%); clamp to a sane range.
      commission_rate: Math.min(1, Math.max(0, Number(commission_rate) || 0)),
      active,
      phone: normalizedPhone,
      birthday: birthday || null,
      hire_date: hire_date || null,
      employment_ended_at: employment_ended_at || null,
      exit_survey_enabled: exit_survey_enabled !== false,
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
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const { error } = await getSupabase()
    .from("employees")
    .delete()
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
