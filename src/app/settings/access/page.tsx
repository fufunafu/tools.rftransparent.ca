import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getAccessOverview } from "@/lib/access";
import { getSettingChanges } from "@/lib/settings-audit";
import AccessPanel from "@/components/admin/settings/AccessPanel";
import ChangeLog from "@/components/admin/settings/ChangeLog";

export const metadata: Metadata = {
  title: "Who Can Sign In | Settings | RF Tools",
  robots: { index: false, follow: false },
};

export default async function AccessPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  // The list of everyone with a way into the company's data is itself
  // sensitive — employees who can reach Settings don't get to read it.
  if (!(await isAdminUser())) {
    return (
      <div className="max-w-3xl mx-auto">
        <h2 className="text-xl font-semibold text-sand-900">Who Can Sign In</h2>
        <p className="text-sm text-sand-500 mt-1">
          Only admins can view the access list. Ask an admin if you need someone added.
        </p>
      </div>
    );
  }

  const [overview, { changes, tableMissing }] = await Promise.all([
    getAccessOverview(),
    getSettingChanges("access"),
  ]);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <AccessPanel initial={overview} currentUser={user.email ?? ""} />
      {/* Sibling rather than a child of the panel, so the log stays a server
          component and refreshes with the page after a change. */}
      <ChangeLog changes={changes} unavailable={tableMissing} />
    </div>
  );
}
