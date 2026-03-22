import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import HealthCheckDashboard from "@/components/admin/HealthCheckDashboard";

export const metadata: Metadata = {
  title: "System Health | RF Tools",
  robots: { index: false, follow: false },
};

export default async function HealthCheckPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-5xl mx-auto">
      <HealthCheckDashboard />
    </div>
  );
}
