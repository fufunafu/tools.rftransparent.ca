// Pure email-based authorization checks. No request/cookie state, so this
// module is safe to import from both Server Components and proxy.ts. The
// session/user resolution lives in admin-auth.ts; this file only answers
// "should this email be allowed?".

import { getSupabase } from "@/lib/supabase";

export const OWNER_EMAIL = "fuannegao25@gmail.com";

function allowedDomains(): string[] {
  return (
    process.env.ADMIN_ALLOWED_DOMAINS
      ?.split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

function normalize(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const e = raw.toLowerCase().trim();
  return e || null;
}

// Anyone allowed to access the site at all: owner, allowlisted company
// domains, active employees (either primary or alt email), or manual
// overrides in admin_users.
export async function isAuthorizedEmail(raw: string | undefined | null): Promise<boolean> {
  const email = normalize(raw);
  if (!email) return false;

  if (email === OWNER_EMAIL) return true;

  const domains = allowedDomains();
  if (domains.length) {
    const domain = email.split("@")[1];
    if (domain && domains.includes(domain)) return true;
  }

  if (await employeeMatches(email)) return true;

  try {
    const { data } = await getSupabase()
      .from("admin_users")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (data) return true;
  } catch {
    // admin_users table may not exist yet
  }

  return false;
}

// Admin = owner / allowed domain / admin_users override. Excludes the
// employee-table path so we can distinguish "got in because they're an
// active employee" from "got in because they're an admin."
export async function isAdminEmail(raw: string | undefined | null): Promise<boolean> {
  const email = normalize(raw);
  if (!email) return false;

  if (email === OWNER_EMAIL) return true;

  const domains = allowedDomains();
  if (domains.length) {
    const domain = email.split("@")[1];
    if (domain && domains.includes(domain)) return true;
  }

  try {
    const { data } = await getSupabase()
      .from("admin_users")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (data) return true;
  } catch {
    // admin_users table may not exist yet
  }

  return false;
}

// Sign-off authority for the reimbursement workflow. Only people in the
// management department (or the owner) can approve/reject — admin status
// alone doesn't imply that authority.
export async function isManagementEmail(raw: string | undefined | null): Promise<boolean> {
  const email = normalize(raw);
  if (!email) return false;
  if (email === OWNER_EMAIL) return true;

  return employeeMatches(email, { managementOnly: true });
}

// Shared employees-table lookup. Tries the new email_alt path first; if
// that fails (pre-migration: column doesn't exist), falls back to a
// primary-email-only lookup so existing employees aren't locked out
// before the migration runs.
async function employeeMatches(
  email: string,
  opts?: { managementOnly?: boolean },
): Promise<boolean> {
  const sb = getSupabase();

  // Preferred query — matches either primary or alt email.
  let q = sb
    .from("employees")
    .select("id")
    .or(`email.eq.${email},email_alt.eq.${email}`)
    .eq("active", true);
  if (opts?.managementOnly) q = q.eq("department", "management");
  const { data, error } = await q.maybeSingle();

  if (!error) return !!data;

  // Fallback: primary email only, in case email_alt isn't migrated yet.
  let q2 = sb.from("employees").select("id").eq("email", email).eq("active", true);
  if (opts?.managementOnly) q2 = q2.eq("department", "management");
  const fallback = await q2.maybeSingle();
  return !!fallback.data;
}
