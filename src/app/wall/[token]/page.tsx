import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWallToken } from "@/lib/settings";
import { getOpsDashboard } from "@/lib/ops-dashboard";
import { getTicketStats } from "@/lib/home-dashboard";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import WallBoard from "@/components/admin/WallBoard";

export const metadata: Metadata = {
  title: "Operations — Wall",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The office TV board. Authenticated by an unguessable token rather than a
 * session, so no shared machine is left permanently signed into the tools.
 *
 * A wrong or missing token 404s — never a redirect to /login, which would tell
 * a probe that the route exists and is worth guessing at.
 */
export default async function WallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const expected = await getWallToken();
  if (!expected || token !== expected) notFound();

  const [data, tickets] = await Promise.all([getOpsDashboard(), getTicketStats()]);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <WallBoard
      data={data}
      today={today}
      ticketStats={tickets.ok ? tickets.value : null}
      generatedAt={new Date().toISOString()}
    />
  );
}
