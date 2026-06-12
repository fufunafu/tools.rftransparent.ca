import type { Metadata } from "next";
import {
  getPurchasingSettings,
  listProductsWithMetrics,
} from "@/lib/purchasing/queries";
import { getInventoryForecasts } from "@/lib/purchasing/forecast";
import ReorderTable from "@/components/admin/purchasing/ReorderTable";

export const metadata: Metadata = {
  title: "Reorder | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingReorderPage() {
  const [products, forecasts, settings] = await Promise.all([
    listProductsWithMetrics(),
    getInventoryForecasts().catch(() => ({})),
    getPurchasingSettings(),
  ]);
  return (
    <ReorderTable
      initialProducts={products}
      initialForecasts={forecasts}
      settings={settings}
    />
  );
}
