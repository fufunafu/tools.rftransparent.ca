import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import LeadsDashboard from "@/components/admin/LeadsDashboard";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";
import { leadStoreFromSlug, leadStoreLabel } from "@/lib/customer-service/lead-store";

type Params = Promise<{ store: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const store = leadStoreFromSlug((await params).store);
  return {
    title: `${store ? leadStoreLabel(store) : "Leads"} Leads | Customer Service | RF Tools`,
    robots: { index: false, follow: false },
  };
}

export default async function LeadsPage({ params }: { params: Params }) {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  // /customer-service/leads/rf or /customer-service/leads/bc
  const store = leadStoreFromSlug((await params).store);
  if (!store) notFound();

  // Server snapshot used to keep relative dates stable through hydration.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();
  const initialBounds = leadTrendQueryBounds("30d", new Date(renderedAt));
  const initialLeads = await getCachedLeads(
    initialBounds?.from,
    initialBounds?.to,
    store,
  ).catch(() => null);

  return (
    <div className="mx-auto max-w-[1900px] space-y-6">
      <LeadsDashboard
        initialLeads={initialLeads}
        initialNow={renderedAt}
        initialBounds={initialBounds}
        store={store}
      />
    </div>
  );
}
