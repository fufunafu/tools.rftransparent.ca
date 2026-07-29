import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { getNotificationSettings } from "@/lib/settings";
import { getStores } from "@/lib/shopify";
import NotificationsForm from "@/components/admin/settings/NotificationsForm";
import ChangeLog from "@/components/admin/settings/ChangeLog";
import { getSettingChanges } from "@/lib/settings-audit";

export const metadata: Metadata = {
  title: "Notifications | Settings | RF Tools",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const [settings, canEdit, log] = await Promise.all([
    getNotificationSettings(),
    isAdminUser(),
    getSettingChanges("notifications"),
  ]);
  const stores = getStores().map((s) => ({ id: s.id, label: s.label }));

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <NotificationsForm initial={settings} stores={stores} canEdit={canEdit} />
      <ChangeLog changes={log.changes} unavailable={log.tableMissing} />
    </div>
  );
}
