import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import LeadsDashboard from "@/components/admin/LeadsDashboard";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";
import { defaultLeadStoreForRegion, isLeadStoreId } from "@/lib/customer-service/lead-store";

export const metadata: Metadata = {
  title: "Leads | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  // Server snapshot used to keep relative dates stable through hydration.
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
    <div className="mx-auto max-w-[1900px] space-y-6">
      <LeadsDashboard
        initialLeads={initialLeads}
        initialNow={renderedAt}
        initialBounds={initialBounds}
        defaultStore={defaultStore}
        storeFromUrl={isLeadStoreId(storeParam)}
      />
    </div>
  );
}
