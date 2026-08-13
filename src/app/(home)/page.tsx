import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated, isAdminUser } from "@/lib/admin-auth";
import { SWRProvider } from "@/lib/swr-provider";
import MobileHome from "@/components/MobileHome";
import { getOpsDashboard } from "@/lib/ops-dashboard";
import { getTicketStats, getAutomationHealth } from "@/lib/home-dashboard";
import { getWallToken } from "@/lib/settings";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import OpsDashboard from "@/components/admin/OpsDashboard";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const metadata: Metadata = {
  title: "Dashboard | RF Tools",
  robots: { index: false, follow: false },
};

// Numbers are live; nothing here should be prerendered or held.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isAuthenticated())) redirect("/login");

  // Employees get the app-style Home on phones (clock status + their tools);
  // admins keep the ops dashboard everywhere.
  const admin = await isAdminUser();

  const [data, tickets, automations, wallToken] = await Promise.all([
    getOpsDashboard(),
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
    <>
      {/* The cached() layer (5 min TTLs) absorbs most of the cost; each tick
          mainly re-reads Supabase, so 90s keeps home and wall in step. */}
      <AutoRefresh intervalMs={90_000} />
      {!admin && (
        <div className="md:hidden">
          <SWRProvider>
            <MobileHome />
          </SWRProvider>
        </div>
      )}
      <div className={admin ? undefined : "hidden md:block"}>
        <OpsDashboard
          data={data}
          today={today}
          attention={attention}
          ticketStats={tickets.ok ? tickets.value : null}
          wallHref={wallToken ? `/wall/${wallToken}` : null}
        />
      </div>
    </>
  );
}
