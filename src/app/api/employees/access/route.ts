import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isManagementUser } from "@/lib/admin-auth";
import { quotePostgrestValue } from "@/lib/postgrest";
import { getSupabase } from "@/lib/supabase";
import type { AccessStatus, LoginMethod } from "@/lib/access-templates";

const SELECT = "id, employee_id, system, login_method, account_id, owner_email, status, note, created_at, updated_at";

const LOGIN_METHODS: LoginMethod[] = ["google_sso", "microsoft_sso", "password", "magic_link", "none"];
const STATUSES: AccessStatus[] = ["not_requested", "requested", "active", "revoked"];

/**
 * The employee whose rows the caller is entitled to read without being an
 * admin: their own, and only their own. Resolved from the session address the
 * way /api/admin/me resolves a profile — never from the query string, which
 * the caller controls.
 */
async function ownEmployeeId(email: string): Promise<string | null> {
  const quoted = quotePostgrestValue(email.toLowerCase());
  const { data, error } = await getSupabase()
    .from("employees")
    .select("id")
    .or(`email.eq.${quoted},email_alt.eq.${quoted}`)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [admin, management] = await Promise.all([isAdminUser(), isManagementUser()]);

  let employeeId: string | null;
  if (admin || management) {
    // Only these two may name somebody else.
    employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }
  } else {
    employeeId = await ownEmployeeId(user.email);
    if (!employeeId) {
      // Signed in without an employee profile (the owner, a domain account).
      // Nothing to show, and nothing to apologise for.
      return NextResponse.json({ access: [] });
    }
  }

  const { data, error } = await getSupabase()
    .from("employee_access")
    .select(SELECT)
    .eq("employee_id", employeeId)
    .order("system");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ access: data ?? [] });
}

// Editing somebody's access list is an administrative act, whoever it belongs
// to: an employee may read their own row but never move it to "active".
export async function PATCH(req: NextRequest) {
  if (!(await isAdminUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.system === "string" && body.system.trim()) patch.system = body.system.trim();
  if (LOGIN_METHODS.includes(body.login_method)) patch.login_method = body.login_method;
  if (STATUSES.includes(body.status)) patch.status = body.status;
  if ("account_id" in body) patch.account_id = body.account_id?.trim() || null;
  if ("owner_email" in body) patch.owner_email = body.owner_email?.trim().toLowerCase() || null;
  if ("note" in body) patch.note = body.note?.trim() || null;

  const { data, error } = await getSupabase()
    .from("employee_access")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ access: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await getSupabase().from("employee_access").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
