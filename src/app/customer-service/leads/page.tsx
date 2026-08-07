import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import LeadsDashboard from "@/components/admin/LeadsDashboard";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";

export const metadata: Metadata = {
  title: "Leads | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function LeadsPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  // Server snapshot used to keep relative dates stable through hydration.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const initialBounds = leadTrendQueryBounds("30d", new Date(renderedAt));
  const initialLeads = await getCachedLeads(
    initialBounds?.from,
    initialBounds?.to,
  ).catch(() => null);

  return (
    <div className="mx-auto max-w-[1900px] space-y-6">
      <LeadsDashboard
        initialLeads={initialLeads}
        initialNow={renderedAt}
        initialBounds={initialBounds}
      />
    </div>
  );
}
