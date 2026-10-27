import type { Metadata } from "next";
import { getSalesOverview } from "@/lib/purchasing/sales-queries";
import SalesHistory from "@/components/admin/purchasing/SalesHistory";
export const metadata: Metadata = { title: "Sales history | Purchasing | RF Tools", robots: { index: false, follow: false } };
export default async function PurchasingSalesPage({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const initial = await getSalesOverview();
  const { sku } = await searchParams;
  return <SalesHistory initial={initial} initialSku={sku} />;
}
