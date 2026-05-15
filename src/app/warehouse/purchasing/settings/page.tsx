import type { Metadata } from "next";
import { getPurchasingSettings } from "@/lib/purchasing/queries";
import SettingsForm from "@/components/admin/purchasing/SettingsForm";

export const metadata: Metadata = {
  title: "Settings | Purchasing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PurchasingSettingsPage() {
  const settings = await getPurchasingSettings();
  return <SettingsForm initialSettings={settings} />;
}
