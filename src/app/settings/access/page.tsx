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
  // sensitive. Employees who can reach Settings do not get to read it.
  if (!(await isAdminUser())) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-6 w-6" aria-hidden="true">
              <rect x="5.25" y="10" width="13.5" height="10" rx="2" />
              <path strokeLinecap="round" d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
            </svg>
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">Admin only</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Access control is restricted</h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
            Only administrators can review who is allowed to sign in. Ask an admin if someone needs access.
          </p>
        </div>
      </div>
    );
  }

  const [overview, { changes, tableMissing }] = await Promise.all([
    getAccessOverview(),
    getSettingChanges("access"),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AccessPanel initial={overview} currentUser={user.email ?? ""} />
      {/* Keep this as a server component so it refreshes after a change. */}
      <ChangeLog changes={changes} unavailable={tableMissing} />
    </div>
  );
}
