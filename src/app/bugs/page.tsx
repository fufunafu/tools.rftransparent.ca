import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import BugsDashboard from "@/components/admin/BugsDashboard";

export const metadata: Metadata = {
  title: "Bug Reports | RF Tools",
  robots: { index: false, follow: false },
};

export default async function BugsPage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  const isAdmin = await isAdminUser();

  return (
    <div className="max-w-6xl mx-auto">
      <BugsDashboard isAdmin={isAdmin} currentUser={user.email} />
    </div>
  );
}
