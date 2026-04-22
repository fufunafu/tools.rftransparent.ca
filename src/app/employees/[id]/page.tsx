import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import EmployeeDetail from "@/components/admin/EmployeeDetail";

export const metadata: Metadata = {
  title: "Employee | RF Tools",
  robots: { index: false, follow: false },
};

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  const { id } = await params;
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <EmployeeDetail id={id} />
    </div>
  );
}
