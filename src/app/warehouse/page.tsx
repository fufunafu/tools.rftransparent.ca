import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import KPITabBar from "@/components/admin/KPITabBar";
import { EmployeeTab } from "@/components/admin/KPIDashboard";

export const metadata: Metadata = {
  title: "Warehouse | RF Tools",
  robots: { index: false, follow: false },
};

export default async function WarehousePage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="fixed inset-0 z-50 bg-sand-50 flex flex-col">
      <div className="border-b border-sand-200/60 bg-white px-6 py-3 shrink-0">
        <div className="flex items-center justify-between max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3">
            <a href="/" className="text-lg font-serif font-semibold text-sand-900 hover:text-accent transition-colors">
              RF Transparent
            </a>
            <span className="text-sand-300">/</span>
            <h1 className="text-sm font-medium text-sand-600">Warehouse</h1>
          </div>
          <a
            href="/employees"
            className="px-3 py-1.5 text-sm text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors"
          >
            Manage Employees
          </a>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-[1400px] mx-auto space-y-6">
          <KPITabBar />
          <EmployeeTab department="warehouse" />
        </div>
      </div>
    </div>
  );
}
