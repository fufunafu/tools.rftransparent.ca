import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";

// Everything that grants a way into the app, gathered in one place so the
// question "who can sign in?" has an answer that isn't "open the database".
//
// The rules themselves live in authz.ts — this module only reports on them,
// and must be kept in step with isAuthorizedEmail/isAdminEmail.

export interface AdminOverride {
  email: string;
  created_at: string | null;
}

export interface EmployeeAccess {
  id: string;
  name: string;
  email: string | null;
  email_alt: string | null;
  department: string;
}

export interface AuthAccount {
  email: string;
  last_sign_in_at: string | null;
  created_at: string;
  // How they sign in: "google", "email" (password), or both.
  providers: string[];
}

export interface AccessOverview {
  owner: string;
  domains: string[];
  admins: AdminOverride[];
  // Present when the admin_users table hasn't been created — the app treats
  // that as "no overrides", so the page should say so rather than imply the
  // list is empty by choice.
  adminsUnavailable: boolean;
  employees: EmployeeAccess[];
  accounts: AuthAccount[];
  accountsUnavailable: boolean;
}

export function allowedDomains(): string[] {
  return (
    process.env.ADMIN_ALLOWED_DOMAINS?.split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function getAdminOverrides(): Promise<{ admins: AdminOverride[]; unavailable: boolean }> {
  try {
    const { data, error } = await getSupabase().from("admin_users").select("*");
    if (error) return { admins: [], unavailable: true };
    const admins = (data ?? [])
      .map((row: Record<string, unknown>) => ({
        email: String(row.email ?? ""),
        // The table was created by hand, so don't assume a created_at column.
        created_at: typeof row.created_at === "string" ? row.created_at : null,
      }))
      .filter((a) => a.email)
      .sort((a, b) => a.email.localeCompare(b.email));
    return { admins, unavailable: false };
  } catch {
    return { admins: [], unavailable: true };
  }
}

async function getActiveEmployees(): Promise<EmployeeAccess[]> {
  try {
    const { data, error } = await getSupabase()
      .from("employees")
      .select("id, name, email, email_alt, department")
      .eq("active", true)
      .order("name");
    if (error) return [];
    // Only employees with an address can actually sign in.
    return ((data ?? []) as EmployeeAccess[]).filter((e) => e.email || e.email_alt);
  } catch {
    return [];
  }
}

async function getAuthAccounts(): Promise<{ accounts: AuthAccount[]; unavailable: boolean }> {
  try {
    const { data, error } = await getSupabase().auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return { accounts: [], unavailable: true };
    const accounts = data.users
      .filter((u) => u.email)
      .map((u) => ({
        email: u.email!.toLowerCase(),
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at,
        providers: u.app_metadata?.providers ?? (u.app_metadata?.provider ? [u.app_metadata.provider] : []),
      }))
      .sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));
    return { accounts, unavailable: false };
  } catch {
    return { accounts: [], unavailable: true };
  }
}

export async function getAccessOverview(): Promise<AccessOverview> {
  const [{ admins, unavailable: adminsUnavailable }, employees, { accounts, unavailable: accountsUnavailable }] =
    await Promise.all([getAdminOverrides(), getActiveEmployees(), getAuthAccounts()]);

  return {
    owner: OWNER_EMAIL,
    domains: allowedDomains(),
    admins,
    adminsUnavailable,
    employees,
    accounts,
    accountsUnavailable,
  };
}

/**
 * Why a given address can sign in, in the same precedence order authz.ts
 * checks. Returns every reason, since access surviving the removal of one
 * route is exactly what's easy to get wrong.
 */
export function accessReasons(email: string, overview: AccessOverview): string[] {
  const e = normalizeEmail(email);
  const reasons: string[] = [];
  if (e === overview.owner.toLowerCase()) reasons.push("Owner");
  const domain = e.split("@")[1];
  if (domain && overview.domains.includes(domain)) reasons.push(`Domain @${domain}`);
  if (overview.employees.some((emp) => emp.email?.toLowerCase() === e || emp.email_alt?.toLowerCase() === e))
    reasons.push("Active employee");
  if (overview.admins.some((a) => a.email.toLowerCase() === e)) reasons.push("Manual admin");
  return reasons;
}
