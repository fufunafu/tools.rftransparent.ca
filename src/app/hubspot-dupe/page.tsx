import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import CrmWorkspace from "@/components/crm/CrmWorkspace";
import { canAccessCrm } from "@/lib/crm/access";

export const metadata: Metadata = { title: "HubSpot Dupe", description: "Customer records, conversations, notes and follow-up tasks in RF Tools." };
export const dynamic = "force-dynamic";
export default async function HubspotDupePage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  if (!(await canAccessCrm())) redirect("/access-denied");
  return <CrmWorkspace email={user.email.toLowerCase()} canManage={await isManagementUser()} />;
}
