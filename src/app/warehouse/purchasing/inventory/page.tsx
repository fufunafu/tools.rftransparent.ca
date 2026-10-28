import type { Metadata } from "next";
import { getPurchasingPlanning } from "@/lib/purchasing/queries";
import InventoryTable from "@/components/admin/purchasing/InventoryTable";

export const metadata: Metadata = {
  title: "Inventory | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingInventoryPage() {
  const { products, forecasts, settings } = await getPurchasingPlanning();
  return (
    <InventoryTable
      initialProducts={products}
      initialForecasts={forecasts}
      settings={settings}
    />
  );
}
