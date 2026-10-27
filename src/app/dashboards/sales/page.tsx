import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { readSalesDashboardSnapshot } from "@/lib/sales-dashboard-snapshot";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import SalesManagerDashboard from "@/components/admin/SalesManagerDashboard";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const metadata: Metadata = {
  title: "Sales Manager Dashboard | RF Tools",
  robots: { index: false, follow: false },
};

// Authenticate each request, then read the durable sales snapshot.
export const dynamic = "force-dynamic";

export default async function SalesManagerPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const snapshot = await readSalesDashboardSnapshot();
  const unavailable = { ok: false as const, error: "The first sales update is being prepared. This page refreshes automatically." };

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(snapshot ? new Date(snapshot.asOf) : new Date());

  return (
    <>
      <AutoRefresh intervalMs={90_000} />
      <SalesManagerDashboard
        sales={snapshot ? { ok: true, value: snapshot.sales } : unavailable}
        customerService={snapshot ? { ok: true, value: snapshot.customerService } : unavailable}
        performers={snapshot ? { ok: true, value: snapshot.performers } : unavailable}
        followup={snapshot ? { ok: true, value: snapshot.followup } : unavailable}
        today={today}
        asOf={snapshot?.asOf}
        delayed={snapshot?.delayed ?? false}
      />
    </>
  );
}
