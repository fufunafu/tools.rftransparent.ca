import type { Metadata } from "next";
import { redirect } from "next/navigation";
import WarehouseReportForm from "@/components/warehouse/WarehouseReportForm";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";

export const metadata: Metadata = {
  title: "Daily Report | Logistics | RF Tools",
  robots: { index: false, follow: false },
};

export default async function WarehouseReportPage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  // Warehouse staff file their own report here. Management (including the
  // owner) can open it too so they can see and, if needed, file the same form.
  const employee = await findActiveEmployeeByEmail(user.email);
  const isWarehouse = employee?.department === "warehouse";
  if (!isWarehouse && !(await isManagementUser())) redirect("/access-denied");
  return <WarehouseReportForm employeeName={employee?.name ?? user.email} />;
}
