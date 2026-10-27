import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser } from "@/lib/admin-auth";
import AmazonSecuritySetup from "@/components/amazon/AmazonSecuritySetup";

export const metadata: Metadata = { title: "Amazon access security | RF Tools", robots: { index: false, follow: false } };

export default async function AmazonSecurityPage() {
  if (!(await isAdminUser())) redirect("/login?next=/amazon/security");
  return <AmazonSecuritySetup />;
}
