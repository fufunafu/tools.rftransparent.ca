import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderDetail } from "@/lib/purchasing/queries";
import OrderDetail from "@/components/admin/purchasing/OrderDetail";

export const metadata: Metadata = {
  title: "Order | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderDetail(id);
  if (!order) notFound();
  return <OrderDetail initialOrder={order} />;
}
