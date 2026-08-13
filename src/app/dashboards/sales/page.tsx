import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import {
  getCustomerServiceOps,
  getFollowupOverview,
  getSalesByStore,
  getTopPerformers,
} from "@/lib/ops-dashboard";
import { getStores } from "@/lib/shopify";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import SalesManagerDashboard from "@/components/admin/SalesManagerDashboard";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const metadata: Metadata = {
  title: "Sales Manager Dashboard | RF Tools",
  robots: { index: false, follow: false },
};

// Numbers are live; nothing here should be prerendered or held.
export const dynamic = "force-dynamic";

export default async function SalesManagerPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const [sales, customerService, performers, followup] = await Promise.all([
    getSalesByStore(),
    getCustomerServiceOps(),
    getTopPerformers(),
    getFollowupOverview(getStores().map((s) => s.id)),
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
      <SalesManagerDashboard
        sales={sales}
        customerService={customerService}
        performers={performers}
        followup={followup}
        today={today}
      />
    </>
  );
}
