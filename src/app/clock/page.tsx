import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { SWRProvider } from "@/lib/swr-provider";
import ClockPanel from "@/components/ClockPanel";

export const metadata: Metadata = {
  title: "Clock | RF Tools",
  robots: { index: false, follow: false },
};

export default async function ClockPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">Clock</h1>
      <p className="mb-6 text-sm text-slate-500">One tap in, one tap out.</p>
      <SWRProvider>
        <ClockPanel />
      </SWRProvider>
    </div>
  );
}
