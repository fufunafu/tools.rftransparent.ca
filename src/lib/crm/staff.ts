import "server-only";
import { getSupabase } from "@/lib/supabase";

export interface CrmStaffMember { email: string; name: string; department: string }

/** Active people who can own CRM work: sales, customer service and management. */
export async function crmStaff(): Promise<CrmStaffMember[]> {
  const result = await getSupabase().from("employees").select("name,email,department").eq("active", true)
    .in("department", ["sales", "customer_service", "management"]).not("email", "is", null).order("name");
  if (result.error) throw new Error("Staff list unavailable");
  const seen = new Set<string>();
  return ((result.data ?? []) as { name: string | null; email: string | null; department: string }[]).flatMap(row => {
    const email = row.email?.trim().toLowerCase();
    if (!email || seen.has(email)) return [];
    seen.add(email);
    return [{ email, name: row.name?.trim() || email, department: row.department }];
  });
}
