import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import WarehouseDashboard from "@/components/warehouse/WarehouseDashboard";

export const metadata: Metadata = {
  title: "Warehouse | RF Tools",
  robots: { index: false, follow: false },
};

export default async function WarehousePage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <WarehouseDashboard />
    </div>
  );
}
