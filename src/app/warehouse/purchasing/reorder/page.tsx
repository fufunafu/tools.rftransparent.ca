import type { Metadata } from "next";
import { listProductsWithMetrics } from "@/lib/purchasing/queries";
import ReorderTable from "@/components/admin/purchasing/ReorderTable";

export const metadata: Metadata = {
  title: "Reorder | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingReorderPage() {
  const products = await listProductsWithMetrics();
  return <ReorderTable initialProducts={products} />;
}
