import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PersonalSalesView from "@/components/PersonalSalesView";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import {
  salesStaffAliases,
  salesStaffPostgrestFilter,
  type PersonalSalesLead,
} from "@/lib/personal-sales";
import { getSupabase } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "My Sales | RF Tools",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  const employee = await findActiveEmployeeByEmail(user.email);
  if (!employee || employee.department !== "sales") {
    if (await isManagementUser()) redirect("/dashboards/sales");
    redirect("/access-denied");
  }

  const aliases = salesStaffAliases(employee.name, employee.shopifyTags);
  let leads: PersonalSalesLead[] = [];
  let loadError: string | null = null;
  if (aliases.length === 0) {
    loadError = "Your sales attribution is not configured. Ask a manager to add a Shopify tag to your employee profile.";
  } else {
    const result = await getSupabase()
      .from("followup_leads")
      .select("id, customer_name, draft_name, quote_amount, lead_status, next_followup_at, closed_at, shopify_created_at")
      .or(salesStaffPostgrestFilter(aliases))
      .not("shopify_status", "in", "(OPEN,DELETED)")
      .order("next_followup_at", { ascending: true, nullsFirst: false })
      .limit(200);
    if (result.error) loadError = "Your sales work could not be loaded. Try again later.";
    else leads = (result.data ?? []) as PersonalSalesLead[];
  }

  return <PersonalSalesView employeeName={employee.name} leads={leads} loadError={loadError} />;
}
