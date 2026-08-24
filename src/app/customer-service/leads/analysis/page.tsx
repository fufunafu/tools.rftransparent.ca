import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import LeadAnalysisDashboard from "@/components/admin/LeadAnalysisDashboard";
import { isAuthenticated } from "@/lib/admin-auth";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";
import { defaultLeadStoreForRegion, isLeadStoreId } from "@/lib/customer-service/lead-store";

export const metadata: Metadata = {
  title: "Lead Analysis | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function LeadAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");

  // Keep relative date buckets stable through hydration.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const initialBounds = leadTrendQueryBounds("30d", new Date(renderedAt));
  // Same RF/BC split as the phone page: ?store= wins, then the visitor's region.
  const { store: storeParam } = await searchParams;
  const region = (await headers()).get("x-vercel-ip-region");
  const defaultStore = isLeadStoreId(storeParam)
    ? storeParam
    : defaultLeadStoreForRegion(region);
  const initialLeads = await getCachedLeads(
    initialBounds?.from,
    initialBounds?.to,
    defaultStore,
  ).catch(() => null);

  return (
    <LeadAnalysisDashboard
      initialLeads={initialLeads}
      initialNow={renderedAt}
      initialBounds={initialBounds}
      defaultStore={defaultStore}
      storeFromUrl={isLeadStoreId(storeParam)}
    />
  );
}
