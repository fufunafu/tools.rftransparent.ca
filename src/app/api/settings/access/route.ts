import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";
import { getAccessOverview, normalizeEmail } from "@/lib/access";
import { looksLikeEmail } from "@/lib/settings";
import { recordSettingChange } from "@/lib/settings-audit";

export const dynamic = "force-dynamic";

// Who can sign in is admin-only information — it's the list of everyone with
// a way into the company's data.
async function requireAdmin() {
  const user = await getAuthenticatedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await isAdminUser()))
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json(await getAccessOverview());
}

// Grant a manual admin override.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!looksLikeEmail(email))
    return NextResponse.json({ error: `"${email}" is not a valid email address.` }, { status: 400 });

  // admin_users was created by hand, so don't assume a unique index exists
  // to upsert against — check first, and treat a repeat grant as a no-op.
  const supabase = getSupabase();
  const { data: existing } = await supabase.from("admin_users").select("email").eq("email", email).maybeSingle();
  if (existing) return NextResponse.json(await getAccessOverview());

  const { error } = await supabase.from("admin_users").insert({ email });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordSettingChange({
    area: "access",
    actor: gate.user.email ?? "unknown",
    summary: `Gave admin access to ${email}`,
  });
  return NextResponse.json(await getAccessOverview());
}

// Revoke a manual admin override. Note this only removes THIS route in —
// someone who is also an employee or on an allowed domain keeps their access,
// which is why the response returns the recomputed overview.
export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const email = normalizeEmail(req.nextUrl.searchParams.get("email") ?? "");
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (email === OWNER_EMAIL.toLowerCase())
    return NextResponse.json(
      { error: "The owner's access is set in code and can't be revoked here." },
      { status: 400 }
    );

  const { error } = await getSupabase().from("admin_users").delete().eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordSettingChange({
    area: "access",
    actor: gate.user.email ?? "unknown",
    summary: `Removed admin access for ${email}`,
  });
  return NextResponse.json(await getAccessOverview());
}
