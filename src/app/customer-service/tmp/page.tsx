import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";

// TEMPORARY: clickable mockup of the Leads page with the Follow-up page
// folded into it. Static HTML with example data — nothing here reads or
// writes real records. Remove this route, the nav entry, and
// public/customer-service/tmp/ once the real page is built.

export const metadata: Metadata = {
  title: "Leads (TMP) | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

const MOCKUP_PATH = "/customer-service/tmp/mockup.html";

export default async function LeadsTmpPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="mx-auto max-w-[1900px] space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          TMP
        </span>
        <span>
          Mockup of the Leads page with Follow-up folded in. Example data only — nothing
          here is saved. Use the Preview / Plan switch and &ldquo;Show what changed&rdquo; in
          the dark bar.
        </span>
        <a
          className="ml-auto font-medium underline"
          href={MOCKUP_PATH}
          target="_blank"
          rel="noreferrer"
        >
          Open full page
        </a>
      </div>
      <iframe
        src={`${MOCKUP_PATH}?embed=1`}
        title="Leads and Follow-up combined mockup"
        className="h-[calc(100dvh-10rem)] w-full rounded-xl border border-slate-200 bg-white"
      />
    </div>
  );
}
