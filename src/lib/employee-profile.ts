import "server-only";

import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";

export interface EmployeeProfile {
  id: string;
  name: string;
  department: string;
  email: string | null;
  emailAlt: string | null;
  shopifyTags: string[];
  location: {
    id: string;
    name: string;
  } | null;
}

interface EmployeeProfileRow {
  id: string;
  name: string;
  department: string;
  email: string | null;
  email_alt?: string | null;
  shopify_tags?: string[] | null;
  locations:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
}

function normalizeRow(row: EmployeeProfileRow | null): EmployeeProfile | null {
  if (!row) return null;
  const location = Array.isArray(row.locations) ? row.locations[0] ?? null : row.locations;
  return {
    id: row.id,
    name: row.name,
    department: row.department,
    email: row.email,
    emailAlt: row.email_alt ?? null,
    shopifyTags: row.shopify_tags ?? [],
    location,
  };
}

export async function findActiveEmployeeByEmail(rawEmail: string): Promise<EmployeeProfile | null> {
  const email = rawEmail.trim().toLowerCase();
  const supabase = getSupabase();
  const preferred = await supabase
    .from("employees")
    .select("id, name, department, email, email_alt, shopify_tags, locations(id, name)")
    .or(`email.eq.${quotePostgrestValue(email)},email_alt.eq.${quotePostgrestValue(email)}`)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!preferred.error) {
    return normalizeRow(preferred.data as unknown as EmployeeProfileRow | null);
  }

  // Keep sign-in working while an older database is still missing email_alt.
  const fallback = await supabase
    .from("employees")
    .select("id, name, department, email, shopify_tags, locations(id, name)")
    .eq("email", email)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (fallback.error) throw new Error(fallback.error.message);
  return normalizeRow(fallback.data as unknown as EmployeeProfileRow | null);
}
