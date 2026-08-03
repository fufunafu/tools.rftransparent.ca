import { NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  getAccountPreferences,
  getCustomDisplayName,
  getPreferredName,
} from "@/lib/account-preferences";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";

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

  const [isAdmin, isManagement, employeeName] = await Promise.all([
    isAdminUser(),
    isManagementUser(),
    user.email ? getDisplayName(user.email.toLowerCase()) : Promise.resolve(null),
  ]);

  const preferredName =
    getCustomDisplayName(user.user_metadata) ??
    employeeName ??
    getPreferredName(user.user_metadata);

  return NextResponse.json({
    email: user.email,
    name: preferredName,
    avatarUrl: getProfileAvatarUrl(user.user_metadata),
    preferences: getAccountPreferences(user.user_metadata),
    isAdmin,
    isManagement,
  });
}
