import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import ProblemsDashboard from "@/components/admin/ProblemsDashboard";

export const metadata: Metadata = {
  title: "Problem Tickets | RF Tools",
  robots: { index: false, follow: false },
};

export default async function ProblemsPage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  const canDelete = await isAdminUser();
  const stores = getStores().map((s) => ({ id: s.id, label: s.label }));

  return (
    <div className="max-w-[1400px] mx-auto">
      <ProblemsDashboard stores={stores} canDelete={canDelete} currentUserEmail={user.email} />
    </div>
  );
}
