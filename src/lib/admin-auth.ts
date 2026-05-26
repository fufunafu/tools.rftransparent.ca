import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAuthorizedEmail, isAdminEmail, isManagementEmail } from "@/lib/authz";
import type { User } from "@supabase/supabase-js";

export async function getAuthenticatedUser(): Promise<User | null> {
  // getSession() reads the JWT from the cookie — no network call.
  // The proxy.ts already ran getUser() (authoritative check) before this.
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user || !user.email) return null;

  return (await isAuthorizedEmail(user.email)) ? user : null;
}

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

export async function clearSessionCookie(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
