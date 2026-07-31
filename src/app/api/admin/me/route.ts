import { NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

// Display name for the sidebar footer. Null for anyone without an employee
// row (the owner, domain-allowlisted accounts) — the caller falls back to
// the email, so this never blocks the response.
async function getDisplayName(email: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("employees")
      .select("name")
      .or(`email.eq.${email},email_alt.eq.${email}`)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data?.name ?? null;
  } catch {
    return null;
  }
}

// Small "who am I" probe for the client. Clients use this to decide whether
// to render admin-only UI (e.g., the "set password" button on the employee
// drawer). The server still re-checks on every mutation — this endpoint is
// purely cosmetic.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [isAdmin, isManagement, name] = await Promise.all([
    isAdminUser(),
    isManagementUser(),
    user.email ? getDisplayName(user.email.toLowerCase()) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    email: user.email,
    name,
    isAdmin,
    isManagement,
  });
}
