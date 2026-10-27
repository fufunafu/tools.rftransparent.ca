import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import CrmWorkspace from "@/components/crm/CrmWorkspace";
import { canAccessCrm } from "@/lib/crm/access";
import { getCrmStatus, listCrmRecords } from "@/lib/crm/data";
import { CRM_INITIAL_LIST_URL } from "@/lib/crm/types";

export const metadata: Metadata = { title: "HubSpot Dupe", description: "Customer records, conversations, notes and follow-up tasks in RF Tools." };
export const dynamic = "force-dynamic";
export default async function HubspotDupePage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  if (!(await canAccessCrm())) redirect("/access-denied");
  const email = user.email.toLowerCase();
  const [initialPage, initialStatus, canManage] = await Promise.all([
    listCrmRecords(new URLSearchParams(CRM_INITIAL_LIST_URL.split("?")[1]), email).catch(() => undefined),
    getCrmStatus().catch(() => undefined),
    isManagementUser(),
  ]);
  return <CrmWorkspace email={email} canManage={canManage} initialPage={initialPage} initialStatus={initialStatus} />;
}
