import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated, isAdminUser } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import ProblemsDashboard from "@/components/admin/ProblemsDashboard";

export const metadata: Metadata = {
  title: "Problem Tickets | RF Tools",
  robots: { index: false, follow: false },
};

export default async function ProblemsPage() {
  if (!(await isAuthenticated())) redirect("/login");
  const canDelete = await isAdminUser();
  const stores = getStores().map((s) => ({ id: s.id, label: s.label }));

  return (
    <div className="max-w-[1400px] mx-auto">
      <ProblemsDashboard stores={stores} canDelete={canDelete} />
    </div>
  );
}
