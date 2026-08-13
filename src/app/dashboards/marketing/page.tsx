import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSalesByStore } from "@/lib/ops-dashboard";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import MarketingOverviewDashboard from "@/components/admin/MarketingOverviewDashboard";

export const metadata: Metadata = {
  title: "Marketing Dashboard | RF Tools",
  robots: { index: false, follow: false },
};

// Numbers are live; nothing here should be prerendered or held.
export const dynamic = "force-dynamic";

export default async function MarketingDashboardPage() {
  if (!(await isAuthenticated())) redirect("/login");

  // Ads data is fetched client-side (same endpoint as /marketing, so the two
  // share the browser cache); only the sales table is server-fetched.
  const sales = await getSalesByStore();

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return <MarketingOverviewDashboard sales={sales} today={today} />;
}
