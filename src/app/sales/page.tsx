import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { EmployeeTab } from "@/components/admin/KPIDashboard";

export const metadata: Metadata = {
  title: "Sales | RF Tools",
  robots: { index: false, follow: false },
};

export default async function SalesPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <EmployeeTab department="sales" />
    </div>
  );
}
