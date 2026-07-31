import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { getOpsDashboard } from "@/lib/ops-dashboard";
import { getTicketStats, getAutomationHealth } from "@/lib/home-dashboard";
import { getWallToken } from "@/lib/settings";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import OpsDashboard from "@/components/admin/OpsDashboard";

export const metadata: Metadata = {
  title: "Operations | RF Tools",
  robots: { index: false, follow: false },
};

// Numbers are live; nothing here should be prerendered or held.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isAuthenticated())) redirect("/login");

  // The collection figures come from the existing accounting route, which is
  // session-gated — forward the caller's cookie rather than re-implementing
  // the Shopify query and risking the two disagreeing.
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const cookie = headerList.get("cookie") ?? "";

  const [data, tickets, automations, wallToken] = await Promise.all([
    getOpsDashboard(`${protocol}://${host}`, cookie),
    getTicketStats(),
    getAutomationHealth(),
    // The board lives at /wall/[token]; linking to bare /wall 404s.
    getWallToken(),
  ]);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  // Same rule as before: only things that changed or broke. Standing backlogs
  // live in the tiles. See the reasoning kept in ops-dashboard.ts.
  const attention: string[] = [];
  if (tickets.ok && tickets.value.oldest && tickets.value.oldest.ageDays >= tickets.value.alertDays) {
    attention.push(
      `Oldest ticket ${tickets.value.oldest.ageDays}d — ${tickets.value.oldest.client_name}`
    );
  }
  if (automations.ok && !automations.value.tableMissing) {
    for (const job of automations.value.failing) attention.push(`${job.label} failed`);
    for (const job of automations.value.silent) attention.push(`${job.label} silent`);
  }
  if (data.sales.ok && data.sales.value.failedStores.length > 0) {
    attention.push(`${data.sales.value.failedStores.join(", ")} didn't respond`);
  }

  return (
    <OpsDashboard
      data={data}
      today={today}
      attention={attention}
      ticketStats={tickets.ok ? tickets.value : null}
      wallHref={wallToken ? `/wall/${wallToken}` : null}
    />
  );
}
