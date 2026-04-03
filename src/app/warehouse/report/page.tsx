import type { Metadata } from "next";
import WarehouseReportForm from "@/components/warehouse/WarehouseReportForm";

export const metadata: Metadata = {
  title: "Daily Report | Warehouse | RF Tools",
  robots: { index: false, follow: false },
};

export default function WarehouseReportPage() {
  return <WarehouseReportForm />;
}
