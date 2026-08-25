import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import LeadsStoreRedirect from "@/components/admin/LeadsStoreRedirect";
import { defaultLeadStoreForRegion, isLeadStoreId, leadsPath } from "@/lib/customer-service/lead-store";

export const metadata: Metadata = {
  title: "Lead Analysis | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

// Legacy URL without a store segment: pick the store and redirect.
export default async function LeadAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");
  const { store: storeParam } = await searchParams;
  if (isLeadStoreId(storeParam)) redirect(leadsPath(storeParam, "analysis"));
  const region = (await headers()).get("x-vercel-ip-region");
  return <LeadsStoreRedirect defaultStore={defaultLeadStoreForRegion(region)} section="analysis" />;
}
