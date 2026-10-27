import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isManagementUser } from "@/lib/admin-auth";
import WarehouseDashboard from "@/components/warehouse/WarehouseDashboard";

export const metadata: Metadata = {
  title: "Logistics | RF Tools",
  robots: { index: false, follow: false },
};

export default async function WarehousePage() {
  if (!(await isManagementUser())) redirect("/access-denied");

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <WarehouseDashboard />
    </div>
  );
}
