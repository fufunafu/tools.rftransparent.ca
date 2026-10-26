"use client";

import type { Result, SalesByStore, CustomerServiceOps, SalesTeamOverview, FollowupOverview } from "@/lib/ops-dashboard";
import { Unavailable } from "@/components/admin/dashboard/widgets";
import { DashboardPane } from "@/components/admin/dashboard/DashboardPane";
import { DashboardSwitcher } from "@/components/admin/dashboard/DashboardSwitcher";
import { SalesSection } from "@/components/admin/dashboard/SalesSection";
import { SalesTeamTable } from "@/components/admin/dashboard/SalesTeamTable";
import { QuotesCard } from "@/components/admin/dashboard/QuotesCard";
import { FollowupCard } from "@/components/admin/dashboard/FollowupCard";

// The sales manager's morning view: revenue vs target, quote flow, the
// follow-up workload, and the sales leaderboard. Pure presentational:
// every number is server-fetched by the page.

export default function SalesManagerDashboard({
  sales,
  customerService,
  performers,
  followup,
  today,
}: {
  sales: Result<SalesByStore>;
  customerService: Result<CustomerServiceOps>;
  performers: Result<SalesTeamOverview>;
  followup: Result<FollowupOverview>;
  today: string;
}) {
  return (
    <DashboardPane>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Sales Manager</h2>
          <p className="text-[12.5px] text-slate-500 mt-0.5">{today} · all stores</p>
        </div>
        <DashboardSwitcher current="/dashboards/sales" />
      </div>

      {sales.ok ? (
        <SalesSection sales={sales.value.stores} />
      ) : (
        <Unavailable label="Sales by store" error={sales.error} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {customerService.ok ? (
          <QuotesCard quotes={customerService.value.quotes} note="all stores" />
        ) : (
          <Unavailable label="Quotes" error={customerService.error} />
        )}
        {followup.ok ? (
          <FollowupCard f={followup.value} note="all stores" />
        ) : (
          <Unavailable label="Leads & follow-ups" error={followup.error} />
        )}
      </div>

      {performers.ok ? (
        <SalesTeamTable data={performers.value} />
      ) : (
        <Unavailable label="Sales team" error={performers.error} />
      )}
    </DashboardPane>
  );
}
