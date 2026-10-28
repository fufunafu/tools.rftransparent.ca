import type { Metadata } from "next";
import { getPurchasingPlanning } from "@/lib/purchasing/queries";
import OverstockTable from "@/components/admin/purchasing/OverstockTable";

export const metadata: Metadata = {
  title: "Overstock | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingOverstockPage() {
  const { products, settings } = await getPurchasingPlanning();
  return <OverstockTable initialProducts={products} settings={settings} />;
}
