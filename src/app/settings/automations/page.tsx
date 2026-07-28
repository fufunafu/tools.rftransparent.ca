import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { getLatestCronRuns } from "@/lib/cron-monitor";
import { AUTOMATION_JOBS } from "@/lib/automations";
import AutomationsPanel from "@/components/admin/settings/AutomationsPanel";

export const metadata: Metadata = {
  title: "Automations | Settings | RF Tools",
  robots: { index: false, follow: false },
};

export default async function AutomationsPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const [{ runs, tableMissing }, canRun] = await Promise.all([
    getLatestCronRuns(AUTOMATION_JOBS.map((j) => j.slug)),
    isAdminUser(),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <AutomationsPanel
        jobs={AUTOMATION_JOBS}
        initialRuns={runs}
        tableMissing={tableMissing}
        canRun={canRun}
      />
    </div>
  );
}
