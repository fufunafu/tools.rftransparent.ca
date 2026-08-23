import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CustomerServiceFrontline from "@/components/CustomerServiceFrontline";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";

export const metadata: Metadata = {
  title: "My Customer Service Queue | RF Tools",
  robots: { index: false, follow: false },
};

export default async function CustomerServicePage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  const employee = await findActiveEmployeeByEmail(user.email);
  if (!employee || employee.department !== "customer_service") {
    if (await isManagementUser()) redirect("/customer-service/phones");
    redirect("/access-denied");
  }
  return <CustomerServiceFrontline viewerEmail={user.email.toLowerCase()} />;
}
