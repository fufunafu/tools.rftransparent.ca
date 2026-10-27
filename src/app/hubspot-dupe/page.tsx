import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import CrmWorkspace from "@/components/crm/CrmWorkspace";
import { canAccessCrm } from "@/lib/crm/access";
import { getCrmStatus, listCrmRecords } from "@/lib/crm/data";
import { getCrmHome } from "@/lib/crm/home";
import { CRM_INITIAL_LIST_URL } from "@/lib/crm/types";
import { crmId } from "@/lib/crm/input";

export const metadata: Metadata = { title: "HubSpot Dupe", description: "Customer records, conversations, notes and follow-up tasks in RF Tools." };
export const dynamic = "force-dynamic";
export default async function HubspotDupePage({ searchParams }: { searchParams?: Promise<{ record?: string | string[]; section?: string | string[] }> } = {}) {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  if (!(await canAccessCrm())) redirect("/access-denied");
  const email = user.email.toLowerCase();
  const params = await searchParams;
  const linkedRecord = crmId.safeParse(params?.record);
  const initialTab = typeof params?.section === "string" && ["contacts", "companies", "tasks"].includes(params.section) ? params.section : "home";
  const initialQuery = new URLSearchParams(CRM_INITIAL_LIST_URL.split("?")[1]);
  initialQuery.set("type", initialTab);
  const [initialHome, initialPage, initialStatus, canManage] = await Promise.all([
    initialTab === "home" ? getCrmHome(email).catch(() => undefined) : undefined,
    initialTab !== "home" ? listCrmRecords(initialQuery, email).catch(() => undefined) : undefined,
    getCrmStatus().catch(() => undefined),
    isManagementUser(),
  ]);
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name;
  return <CrmWorkspace email={email} displayName={typeof displayName === "string" ? displayName : undefined} canManage={canManage} initialTab={initialTab} initialHome={initialHome} initialPage={initialPage} initialStatus={initialStatus} initialRecordId={linkedRecord.success ? linkedRecord.data : undefined} />;
}
