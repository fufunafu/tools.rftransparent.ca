import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

// Provisions or rotates the Supabase password credential for an employee.
// The username they'll type at the login screen is the employee's work
// email. Only admins (owner / allowed domain / admin_users) can call this.
//
// If a Supabase user already exists for that email (e.g., they previously
// signed in with Google), we update their password — adding a second
// sign-in method to the same account. Otherwise we create a fresh user
// with email_confirm: true so they can sign in immediately.
export async function POST(req: NextRequest) {
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const employeeId = body?.employeeId as string | undefined;
  const password = body?.password as string | undefined;

  if (!employeeId || !password) {
    return NextResponse.json(
      { error: "employeeId and password are required" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, name, email, active")
    .eq("id", employeeId)
    .maybeSingle();

  if (empErr || !emp) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  if (!emp.active) {
    return NextResponse.json(
      { error: "Employee is inactive — reactivate them first" },
      { status: 400 }
    );
  }
  if (!emp.email) {
    return NextResponse.json(
      { error: "Set a work email on the employee profile first — it becomes their login username" },
      { status: 400 }
    );
  }

  const loginEmail = emp.email.toLowerCase();

  // Look up the existing Supabase auth user, if any. Pagination is by 1000
  // per page by default; an internal team won't exceed one page, but we
  // still iterate defensively in case the org grows.
  let existingId: string | null = null;
  let page = 1;
  const perPage = 200;
  // Cap iterations so a misbehaving API can't loop forever.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === loginEmail);
    if (match) {
      existingId = match.id;
      break;
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  if (existingId) {
    const { error } = await supabase.auth.admin.updateUserById(existingId, {
      password,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ status: "updated", email: loginEmail });
  }

  const { error } = await supabase.auth.admin.createUser({
    email: loginEmail,
    password,
    email_confirm: true,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: "created", email: loginEmail });
}
