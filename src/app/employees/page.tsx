import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import EmployeesHub from "@/components/admin/EmployeesHub";

export const metadata: Metadata = {
  title: "Employees | RF Tools",
  robots: { index: false, follow: false },
};

export default async function EmployeesPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="mx-auto max-w-7xl">
      <EmployeesHub />
    </div>
  );
}
