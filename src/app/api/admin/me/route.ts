import { NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  getAccountPreferences,
  getCustomDisplayName,
  getPreferredName,
} from "@/lib/account-preferences";
import { deriveDefaultDashboard } from "@/lib/default-dashboard";
import { OWNER_EMAIL } from "@/lib/authz";
import { quotePostgrestValue } from "@/lib/postgrest";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";

interface EmployeeProfile {
  name: string | null;
  department: string | null;
  locationName: string | null;
}

// Display name + role facts for the sidebar. All-null for anyone without an
// employee row (the owner, domain-allowlisted accounts) — the caller falls
// back to the email, so this never blocks the response.
async function getEmployeeProfile(email: string): Promise<EmployeeProfile> {
  const none: EmployeeProfile = { name: null, department: null, locationName: null };
  try {
    const quoted = quotePostgrestValue(email);
    const { data, error } = await getSupabase()
      .from("employees")
      .select("name, department, locations(name)")
      .or(`email.eq.${quoted},email_alt.eq.${quoted}`)
      .limit(1)
      .maybeSingle();
    if (error || !data) return none;
    const locations = data.locations as { name?: string | null } | { name?: string | null }[] | null;
    return {
      name: (data.name as string | null) ?? null,
      department: (data.department as string | null) ?? null,
      locationName: Array.isArray(locations)
        ? locations[0]?.name ?? null
        : locations?.name ?? null,
    };
  } catch {
    return none;
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

  const email = user.email?.toLowerCase() ?? null;
  const [isAdmin, isManagement, profile] = await Promise.all([
    isAdminUser(),
    isManagementUser(),
    email
      ? getEmployeeProfile(email)
      : Promise.resolve<EmployeeProfile>({ name: null, department: null, locationName: null }),
  ]);

  const preferredName =
    getCustomDisplayName(user.user_metadata) ??
    profile.name ??
    getPreferredName(user.user_metadata);

  // Concrete paths — "auto" is resolved here so no client ever has to put
  // the sentinel in an href. The dashboard is the user's picked one, else
  // their role's default; the home page is their explicit choice, else
  // that same dashboard.
  const preferences = getAccountPreferences(user.user_metadata);
  const resolvedDashboard =
    preferences.dashboard !== "auto"
      ? preferences.dashboard
      : deriveDefaultDashboard({
          isOwner: email === OWNER_EMAIL,
          department: profile.department,
          locationName: profile.locationName,
        });
  const resolvedHomePage = preferences.homePage === "auto" ? resolvedDashboard : preferences.homePage;

  return NextResponse.json({
    email: user.email,
    name: preferredName,
    avatarUrl: getProfileAvatarUrl(user.user_metadata),
    preferences,
    resolvedHomePage,
    resolvedDashboard,
    isAdmin,
    isManagement,
  });
}
