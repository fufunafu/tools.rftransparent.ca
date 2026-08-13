import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isAdminUser, isManagementUser } from "@/lib/admin-auth";
import MoreScreen from "@/components/MoreScreen";

export const metadata: Metadata = {
  title: "More | RF Tools",
  robots: { index: false, follow: false },
};

// The phone tab bar's fourth tab: the full tool list. Reachable on desktop
// too, but not linked from the sidebar — desktop already shows everything.
export default async function MorePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const [isAdmin, isManagement] = await Promise.all([isAdminUser(), isManagementUser()]);
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">More</h1>
      <MoreScreen
        viewerAccess={{ isAdmin, isManagement }}
        viewerName={name}
        viewerEmail={user.email ?? ""}
      />
    </div>
  );
}
