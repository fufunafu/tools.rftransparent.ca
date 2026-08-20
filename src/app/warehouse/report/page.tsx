import type { Metadata } from "next";
import { redirect } from "next/navigation";
import WarehouseReportForm from "@/components/warehouse/WarehouseReportForm";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";

export const metadata: Metadata = {
  title: "Daily Report | Logistics | RF Tools",
  robots: { index: false, follow: false },
};

export default async function WarehouseReportPage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  const employee = await findActiveEmployeeByEmail(user.email);
  if (!employee || employee.department !== "warehouse") redirect("/access-denied");
  return <WarehouseReportForm employeeName={employee.name} />;
}
