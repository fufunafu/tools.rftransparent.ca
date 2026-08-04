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
  searchParams: Promise<{
    gmail_status?: string | string[];
    gmail_message?: string | string[];
  }>;
}) {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");
  const canManageGmail = await isAdminUser();
  const params = await searchParams;
  const statusParam = Array.isArray(params.gmail_status)
    ? params.gmail_status[0]
    : params.gmail_status;
  const messageParam = Array.isArray(params.gmail_message)
    ? params.gmail_message[0]
    : params.gmail_message;
  const gmailStatus = ["success", "warning", "error"].includes(statusParam ?? "")
    ? (statusParam as "success" | "warning" | "error")
    : null;
  const gmailNotice = gmailStatus && messageParam
    ? { status: gmailStatus, message: messageParam.slice(0, 500) }
    : null;

  return (
    <div className="mx-auto max-w-7xl">
      <HealthCheckDashboard canManageGmail={canManageGmail} gmailNotice={gmailNotice} />
    </div>
  );
}
