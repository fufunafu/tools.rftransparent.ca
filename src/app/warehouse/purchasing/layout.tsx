import { redirect } from "next/navigation";
import { isAuthenticated, isManagementUser } from "@/lib/admin-auth";
import { SWRProvider } from "@/lib/swr-provider";
import { getPurchasingSummary } from "@/lib/purchasing/queries";
import PurchasingTabs from "@/components/admin/purchasing/PurchasingTabs";
import PurchasingSummaryStrip from "@/components/admin/purchasing/PurchasingSummaryStrip";

export default async function PurchasingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthenticated())) redirect("/login");
  if (!(await isManagementUser())) redirect("/warehouse");

  const summary = await getPurchasingSummary().catch(() => ({
    total_inventory_value: 0,
    units_on_hand: 0,
    open_po_value: 0,
    month_order_value: 0,
  }));

  return (
    <SWRProvider>
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h1 className="text-2xl font-semibold text-sand-900">Purchasing</h1>
          </div>
          <PurchasingSummaryStrip summary={summary} />
          <PurchasingTabs />
        </div>
        {children}
      </div>
    </SWRProvider>
  );
}
