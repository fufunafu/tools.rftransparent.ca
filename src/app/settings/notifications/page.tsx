import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { getNotificationSettings } from "@/lib/settings";
import { getStores } from "@/lib/shopify";
import NotificationsForm from "@/components/admin/settings/NotificationsForm";

export const metadata: Metadata = {
  title: "Notifications | Settings | RF Tools",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const [settings, canEdit] = await Promise.all([getNotificationSettings(), isAdminUser()]);
  const stores = getStores().map((s) => ({ id: s.id, label: s.label }));

  return (
    <div className="max-w-3xl mx-auto">
      <NotificationsForm initial={settings} stores={stores} canEdit={canEdit} />
    </div>
  );
}
