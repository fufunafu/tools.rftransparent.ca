import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAuthorizedEmail, isAdminEmail, isManagementEmail } from "@/lib/authz";
import type { User } from "@supabase/supabase-js";
import { cache } from "react";

export const getAuthenticatedUser = cache(async (): Promise<User | null> => {
  // Revalidate the cookie-backed token at the point where protected pages and
  // APIs make authorization decisions. Proxy remains the fast routing guard,
  // while this cached DAL check keeps direct entry points authoritative.
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  if (!user || !user.email) return null;

  return (await isAuthorizedEmail(user.email)) ? user : null;
});

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthenticatedUser()) !== null;
}

// Distinguishes admins (owner / allowed domain / admin_users override) from
// users who got in solely because they're an active employee. Used to gate
// approval-style actions where employees should only see their own data.
export async function isAdminUser(): Promise<boolean> {
  const user = await getAuthenticatedUser();
  return isAdminEmail(user?.email);
}

// Approve/reject gates for the reimbursement workflow. Admin status (domain
// allowlist, admin_users override) doesn't imply authority to sign off on
// expenses — only people in the management department do. Owner always passes.
export async function isManagementUser(): Promise<boolean> {
  const user = await getAuthenticatedUser();
  return isManagementEmail(user?.email);
}

// Exit survey answers are intentionally narrower than the regular management
// dashboard. The owner always has access; additional recipients must be named
// explicitly in SURVEY_RESTRICTED_ACCESS_EMAILS.
export async function isRestrictedSurveyManager(): Promise<boolean> {
  const user = await getAuthenticatedUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  const configured = new Set(
    (process.env.SURVEY_RESTRICTED_ACCESS_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return email === "fuannegao25@gmail.com" || configured.has(email);
}

export async function clearSessionCookie(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
