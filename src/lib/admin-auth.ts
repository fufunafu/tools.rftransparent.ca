import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { User } from "@supabase/supabase-js";

export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const allowedEmails = process.env.ADMIN_ALLOWED_EMAILS;
  if (allowedEmails) {
    const list = allowedEmails.split(",").map((e) => e.trim().toLowerCase());
    if (!list.includes((user.email ?? "").toLowerCase())) return null;
  }

  return user;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthenticatedUser()) !== null;
}

export async function clearSessionCookie(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
