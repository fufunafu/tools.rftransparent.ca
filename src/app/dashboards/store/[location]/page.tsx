import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { getFollowupOverview, getStoreDashboard } from "@/lib/ops-dashboard";
import { getTicketStats } from "@/lib/home-dashboard";
import { getStoreScope } from "@/lib/store-scopes";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import StoreDashboard from "@/components/admin/StoreDashboard";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const metadata: Metadata = {
  title: "Store Dashboard | RF Tools",
  robots: { index: false, follow: false },
};

// Numbers are live; nothing here should be prerendered or held.
export const dynamic = "force-dynamic";

export default async function StoreDashboardPage({
  params,
}: {
  params: Promise<{ location: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");

  const { location } = await params;
  const scope = getStoreScope(location);
  if (!scope) notFound();

  const [data, followup, tickets] = await Promise.all([
    getStoreDashboard(scope),
    getFollowupOverview(scope.shopifyStoreIds),
    // Tickets only feed the warehouse card; skip the read where it isn't shown.
    scope.showWarehouse ? getTicketStats() : Promise.resolve(null),
  ]);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <>
      {/* Same cadence as the owner dashboard — the cached() layer absorbs the cost. */}
      <AutoRefresh intervalMs={90_000} />
      <StoreDashboard
        scope={scope}
        data={data}
        followup={followup}
        tickets={tickets && tickets.ok ? tickets.value : null}
        today={today}
      />
    </>
  );
}
