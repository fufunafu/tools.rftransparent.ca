import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import MyAccessList from "@/components/admin/MyAccessList";

export const metadata: Metadata = {
  title: "My access | RF Tools",
  robots: { index: false, follow: false },
};

// Everyone signed in may open this. Which rows they get is decided on the
// server from their session address, not from anything the page asks for.
export default async function MyAccessPage() {
  if (!(await isAuthenticated())) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <MyAccessList />
    </div>
  );
}
