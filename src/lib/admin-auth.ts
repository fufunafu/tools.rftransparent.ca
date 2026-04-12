import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export async function getAuthenticatedUser(): Promise<User | null> {
  // getSession() reads the JWT from the cookie — no network call.
  // The proxy.ts already ran getUser() (authoritative check) before this.
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user || !user.email) return null;

  const email = user.email.toLowerCase();

  // Owner account — always has access
  if (email === "fuannegao25@gmail.com") return user;

  const allowedDomains = process.env.ADMIN_ALLOWED_DOMAINS
    ?.split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  // No restriction configured — allow all authenticated users
  if (!allowedDomains?.length) return user;

  // Domain match — allow
  const domain = email.split("@")[1];
  if (allowedDomains.includes(domain)) return user;

  // Not on the allowed domain — check employees table (active employees with an email)
  try {
    const { data: emp } = await getSupabase()
      .from("employees")
      .select("id")
      .eq("email", email)
      .eq("active", true)
      .maybeSingle();
    if (emp) return user;
  } catch {
    // email column may not exist yet
  }

  // Final fallback — check admin_users table for one-off manual overrides
  try {
    const { data } = await getSupabase()
      .from("admin_users")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (data) return user;
  } catch {
    // admin_users table may not exist yet
  }

  return null;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthenticatedUser()) !== null;
}

export async function clearSessionCookie(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
