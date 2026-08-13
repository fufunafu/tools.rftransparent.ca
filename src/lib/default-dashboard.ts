import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";
import { quotePostgrestValue } from "@/lib/postgrest";
import { getAccountPreferences } from "@/lib/account-preferences";
import { scopeForLocationName } from "@/lib/store-scopes";

// "Automatic (by role)" home page: which dashboard an employee lands on after
// signing in. This only ever picks a DEFAULT — every dashboard stays open to
// every signed-in employee (docs/permissions.md).

/**
 * The landing rule, pure so it can be tested exhaustively:
 *   - owner → the owner dashboard
 *   - management with a store location → that store's dashboard
 *   - sales → the sales manager dashboard
 *   - marketing → the marketing dashboard
 *   - everyone else (incl. management without a location, unknown or missing
 *     departments, and locations without a dashboard) → the owner dashboard
 */
export function deriveDefaultDashboard(input: {
  isOwner: boolean;
  department: string | null;
  locationName: string | null;
}): string {
  if (input.isOwner) return "/";
  const department = input.department?.trim().toLowerCase() ?? "";
  if (department === "management" && input.locationName) {
    const scope = scopeForLocationName(input.locationName);
    if (scope) return `/dashboards/store/${scope.slug}`;
  }
  if (department === "sales") return "/dashboards/sales";
  if (department === "marketing") return "/dashboards/marketing";
  return "/";
}

/**
 * The concrete path a signed-in user should land on: their explicit home-page
 * preference when they saved one, otherwise the role-derived default. Never
 * returns "auto" and never throws — auth redirects must not 500 because an
 * employees lookup hiccuped.
 */
export async function resolveLandingPage(user: {
  email?: string | null;
  user_metadata?: unknown;
}): Promise<string> {
  const preferred = getAccountPreferences(user.user_metadata).homePage;
  if (preferred !== "auto") return preferred;

  const email = user.email?.trim().toLowerCase();
  if (!email) return "/";
  if (email === OWNER_EMAIL) return "/";

  try {
    const quoted = quotePostgrestValue(email);
    const { data } = await getSupabase()
      .from("employees")
      .select("department, locations(name)")
      .or(`email.eq.${quoted},email_alt.eq.${quoted}`)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (!data) return "/";
    const locations = data.locations as { name?: string | null } | { name?: string | null }[] | null;
    const locationName = Array.isArray(locations)
      ? locations[0]?.name ?? null
      : locations?.name ?? null;
    return deriveDefaultDashboard({
      isOwner: false,
      department: (data.department as string | null) ?? null,
      locationName,
    });
  } catch {
    return "/";
  }
}
