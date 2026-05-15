import type { Metadata } from "next";
import { listOrdersWithRollup } from "@/lib/purchasing/queries";
import OrdersList from "@/components/admin/purchasing/OrdersList";

export const metadata: Metadata = {
  title: "Orders | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingOrdersPage() {
  const orders = await listOrdersWithRollup();
  return <OrdersList initialOrders={orders} />;
}
