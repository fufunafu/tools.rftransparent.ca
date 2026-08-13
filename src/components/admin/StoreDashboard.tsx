"use client";

import type { Result, FollowupOverview, StoreDashboardData } from "@/lib/ops-dashboard";
import type { TicketStats } from "@/lib/home-dashboard";
import type { StoreScope } from "@/lib/store-scopes";
import { Unavailable } from "@/components/admin/dashboard/widgets";
import { DashboardPane } from "@/components/admin/dashboard/DashboardPane";
import { SalesSection } from "@/components/admin/dashboard/SalesSection";
import { PerformersSection } from "@/components/admin/dashboard/PerformersSection";
import { CustomerServiceCard } from "@/components/admin/dashboard/CustomerServiceCard";
import { WarehouseCard } from "@/components/admin/dashboard/WarehouseCard";
import { FollowupCard } from "@/components/admin/dashboard/FollowupCard";

// One store manager's view: their stores' sales vs target, their phone lines'
// responsiveness, their follow-up queue, and their team. The warehouse card
// (company-wide numbers) appears only where the warehouse physically is.

export default function StoreDashboard({
  scope,
  data,
  followup,
  tickets,
  today,
}: {
  scope: StoreScope;
  data: StoreDashboardData;
  followup: Result<FollowupOverview>;
  tickets: TicketStats | null;
  today: string;
}) {
  return (
    <DashboardPane>
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{scope.label} Store</h2>
        <p className="text-[12.5px] text-slate-500 mt-0.5">
          {today} · {scope.label} stores only
        </p>
      </div>

      {data.sales.ok ? (
        <SalesSection
          sales={data.sales.value.stores}
          storeIds={scope.shopifyStoreIds}
          totalLabel={`${scope.label} total`}
        />
      ) : (
        <Unavailable label="Sales by store" error={data.sales.error} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {data.customerService.ok ? (
          <CustomerServiceCard
            cs={data.customerService.value}
            note={`${scope.label} lines · weekdays · 48h window`}
          />
        ) : (
          <Unavailable label="Customer service" error={data.customerService.error} />
        )}
        {followup.ok ? (
          <FollowupCard f={followup.value} note={`${scope.label} stores`} />
        ) : (
          <Unavailable label="Leads & follow-ups" error={followup.error} />
        )}
      </div>

      {data.warehouse !== null &&
        (data.warehouse.ok ? (
          <WarehouseCard w={data.warehouse.value} tickets={tickets} />
        ) : (
          <Unavailable label="Warehouse & logistics" error={data.warehouse.error} />
        ))}

      {data.performers.ok ? (
        <PerformersSection
          p={data.performers.value}
          locationSlug={scope.slug}
          sections={scope.showWarehouse ? ["sales", "warehouse", "customerService"] : ["sales", "customerService"]}
        />
      ) : (
        <Unavailable label="Top performers" error={data.performers.error} />
      )}
    </DashboardPane>
  );
}
