import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import HealthCheckDashboard from "@/components/admin/HealthCheckDashboard";

export const metadata: Metadata = {
  title: "System Health | RF Tools",
  robots: { index: false, follow: false },
};

export default async function HealthCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_status?: string; gmail_message?: string }>;
}) {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");
  const canManageGmail = await isAdminUser();
  const params = await searchParams;
  const gmailStatus = ["success", "warning", "error"].includes(params.gmail_status ?? "")
    ? (params.gmail_status as "success" | "warning" | "error")
    : null;
  const gmailNotice = gmailStatus && params.gmail_message
    ? { status: gmailStatus, message: params.gmail_message.slice(0, 500) }
    : null;

  return (
    <div className="mx-auto max-w-7xl">
      <HealthCheckDashboard canManageGmail={canManageGmail} gmailNotice={gmailNotice} />
    </div>
  );
}
