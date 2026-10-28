import { redirect } from "next/navigation";
import { isAuthenticated, isManagementUser } from "@/lib/admin-auth";
import { SWRProvider } from "@/lib/swr-provider";
import { getPurchasingSummary } from "@/lib/purchasing/queries";
import PurchasingTabs from "@/components/admin/purchasing/PurchasingTabs";
import PurchasingSummaryStrip from "@/components/admin/purchasing/PurchasingSummaryStrip";

import SalesSyncStatus from "@/components/admin/purchasing/SalesSyncStatus";

export const dynamic = "force-dynamic";

export default async function PurchasingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthenticated())) redirect("/login");
  if (!(await isManagementUser())) redirect("/access-denied");

  const summary = await getPurchasingSummary().catch(() => ({
    total_inventory_value: 0,
    units_on_hand: 0,
    open_po_value: 0,
    month_order_value: 0,
  }));

  return (
    <SWRProvider>
      <div className="mx-auto min-w-0 max-w-[1600px] space-y-5">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold text-sand-900">Purchasing</h1>
            <p className="mt-1 hidden text-sm text-sand-500 sm:block">Keep stock healthy, plan replenishment, and track incoming orders.</p>
          </div>
          <PurchasingSummaryStrip summary={summary} />
          <PurchasingTabs />
          <SalesSyncStatus />
        </div>
        {children}
      </div>
    </SWRProvider>
  );
}
