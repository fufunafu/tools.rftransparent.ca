import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import KPITabBar from "@/components/admin/KPITabBar";
import PipelineDashboard from "@/components/admin/PipelineDashboard";

export const metadata: Metadata = {
  title: "Pipeline | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PipelinePage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <KPITabBar />
      <PipelineDashboard />
    </div>
  );
}
