import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { getCronRunHistory } from "@/lib/cron-monitor";
import { AUTOMATION_JOBS } from "@/lib/automations";
import AutomationsPanel from "@/components/admin/settings/AutomationsPanel";

export const metadata: Metadata = {
  title: "Automations | Settings | RF Tools",
  robots: { index: false, follow: false },
};

export default async function AutomationsPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const [{ history, tableMissing }, canRun] = await Promise.all([
    getCronRunHistory(AUTOMATION_JOBS.map((j) => j.slug)),
    isAdminUser(),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <AutomationsPanel
        jobs={AUTOMATION_JOBS}
        history={history}
        tableMissing={tableMissing}
        canRun={canRun}
      />
    </div>
  );
}
