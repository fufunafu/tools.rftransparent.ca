import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import MarketingDashboard from "@/components/admin/MarketingDashboard";

export const metadata: Metadata = {
  title: "Marketing | RF Tools",
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <MarketingDashboard />
    </div>
  );
}
