import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated, isAdminUser } from "@/lib/admin-auth";
import ReimbursementDashboard from "@/components/admin/reimbursement/ReimbursementDashboard";

export const metadata: Metadata = {
  title: "Reimbursement | Accounting | RF Tools",
  robots: { index: false, follow: false },
};

export default async function ReimbursementPage() {
  if (!(await isAuthenticated())) redirect("/login");
  const admin = await isAdminUser();

  return (
    <div className="max-w-[1100px] mx-auto">
      <ReimbursementDashboard isAdmin={admin} />
    </div>
  );
}
