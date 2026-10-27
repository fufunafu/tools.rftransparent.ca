import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser } from "@/lib/admin-auth";
import AmazonWorkspace from "@/components/amazon/AmazonWorkspace";
import { amazonSecurityState } from "@/lib/amazon/security";

export const metadata: Metadata = { title: "Amazon | RF Tools", robots: { index: false, follow: false } };

export default async function AmazonPage() {
  if (!(await isAdminUser())) redirect("/login");
  const security = await amazonSecurityState().catch(() => null);
  if (!security?.ready) redirect("/amazon/security");
  return <div className="mx-auto max-w-6xl"><AmazonWorkspace /></div>;
}
