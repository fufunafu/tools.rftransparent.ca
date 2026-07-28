import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import AccountForm from "@/components/admin/settings/AccountForm";

export const metadata: Metadata = {
  title: "My Account | Settings | RF Tools",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  return (
    <div className="max-w-2xl mx-auto">
      <AccountForm email={user.email ?? ""} />
    </div>
  );
}
