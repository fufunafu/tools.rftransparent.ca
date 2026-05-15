import type { Metadata } from "next";
import {
  getPurchasingSettings,
  listProductsWithMetrics,
} from "@/lib/purchasing/queries";
import { getInventoryForecasts } from "@/lib/purchasing/forecast";
import InventoryTable from "@/components/admin/purchasing/InventoryTable";

export const metadata: Metadata = {
  title: "Inventory | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingInventoryPage() {
  const [products, forecasts, settings] = await Promise.all([
    listProductsWithMetrics(),
    getInventoryForecasts().catch(() => ({})),
    getPurchasingSettings(),
  ]);
  return (
    <InventoryTable
      initialProducts={products}
      initialForecasts={forecasts}
      settings={settings}
    />
  );
}
