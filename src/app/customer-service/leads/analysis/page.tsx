import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LeadAnalysisDashboard from "@/components/admin/LeadAnalysisDashboard";
import { isAuthenticated } from "@/lib/admin-auth";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";

export const metadata: Metadata = {
  title: "Lead Analysis | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function LeadAnalysisPage() {
  if (!(await isAuthenticated())) redirect("/login");

  // Keep relative date buckets stable through hydration.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const initialBounds = leadTrendQueryBounds("30d", new Date(renderedAt));
  const initialLeads = await getCachedLeads(
    initialBounds?.from,
    initialBounds?.to,
  ).catch(() => null);

  return (
    <LeadAnalysisDashboard
      initialLeads={initialLeads}
      initialNow={renderedAt}
      initialBounds={initialBounds}
    />
  );
}
