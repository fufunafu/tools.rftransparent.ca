import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import LeadAnalysisDashboard from "@/components/admin/LeadAnalysisDashboard";
import { isAuthenticated } from "@/lib/admin-auth";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";
import { leadStoreFromSlug, leadStoreLabel } from "@/lib/customer-service/lead-store";

type Params = Promise<{ store: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const store = leadStoreFromSlug((await params).store);
  return {
    title: `${store ? leadStoreLabel(store) : ""} Lead Analysis | Customer Service | RF Tools`.trim(),
    robots: { index: false, follow: false },
  };
}

export default async function LeadAnalysisPage({ params }: { params: Params }) {
  if (!(await isAuthenticated())) redirect("/login");

  const store = leadStoreFromSlug((await params).store);
  if (!store) notFound();

  // Keep relative date buckets stable through hydration.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const initialBounds = leadTrendQueryBounds("30d", new Date(renderedAt));
  const initialLeads = await getCachedLeads(
    initialBounds?.from,
    initialBounds?.to,
    store,
  ).catch(() => null);

  return (
    <LeadAnalysisDashboard
      initialLeads={initialLeads}
      initialNow={renderedAt}
      initialBounds={initialBounds}
      store={store}
    />
  );
}
