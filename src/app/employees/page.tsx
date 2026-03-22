import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import EmployeeList from "@/components/admin/EmployeeList";

export const metadata: Metadata = {
  title: "Employees | RF Tools",
  robots: { index: false, follow: false },
};

export default async function EmployeesPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-5xl mx-auto">
      <EmployeeList />
    </div>
  );
}
