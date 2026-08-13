"use client";

import Link from "next/link";
import useSWR from "swr";
import { formatDuration, type WeekDay } from "@/lib/time-clock";
import { BUSINESS_TIMEZONE } from "@/lib/dates";

// The phone Home tab: greeting, clock status strip, and the two or three
// tools this person's department actually uses. Rendered only below the md
// breakpoint (the desktop dashboard is untouched).

interface ClockStatus {
  linked: boolean;
  employeeName?: string;
  department?: string;
  locationName?: string | null;
  open?: { id: string; clockInAt: string; stale: boolean } | null;
  week?: WeekDay[];
  weekMinutes?: number;
}

interface QuickLink {
  href: string;
  label: string;
  sub: string;
}

// Everyone gets Tasks; the rest follows the department on the employee
// profile. Unknown/unlinked users get a sensible general set.
function quickLinks(department: string | undefined): QuickLink[] {
  const tasks = { href: "/todos", label: "Tasks", sub: "Your to-do list" };
  const problems = { href: "/customer-service/problems", label: "Problem Tickets", sub: "Open customer issues" };
  switch (department) {
    case "sales":
      return [
        { href: "/customer-service/follow-up", label: "Follow-ups", sub: "Leads waiting on you" },
        { href: "/sales", label: "Sales", sub: "Today's numbers" },
        tasks,
      ];
    case "warehouse":
      return [
        { href: "/warehouse/report", label: "Daily Report", sub: "Submit today's report" },
        { href: "/warehouse", label: "Logistics", sub: "Orders and shipments" },
        tasks,
      ];
    case "customer_service":
      return [
        { href: "/customer-service/phones", label: "Phones", sub: "Calls and callbacks" },
        { href: "/customer-service/follow-up", label: "Follow-ups", sub: "Leads waiting on you" },
        tasks,
      ];
    case "marketing":
      return [
        { href: "/marketing", label: "Marketing", sub: "Campaigns and spend" },
        tasks,
        problems,
      ];
    default:
      return [tasks, problems];
  }
}

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function MobileHome() {
  const { data } = useSWR<ClockStatus>("/api/clock", { refreshInterval: 60_000 });

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);

  const firstName = data?.employeeName?.split(/\s+/)[0];
  const open = data?.open;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-0.5 text-2xl font-bold tracking-tight text-slate-900">
        {greeting(now)}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        {today}
        {data?.locationName ? ` · ${data.locationName}` : ""}
      </p>

      {/* Clock strip — always visible so nobody wonders whether they're on
          the clock. Hidden only for logins with no employee profile. */}
      {data?.linked !== false && (
        <Link
          href="/clock"
          className={`mb-4 flex items-center justify-between rounded-2xl px-4 py-3.5 text-white ${
            open?.stale ? "bg-amber-600" : open ? "bg-emerald-700" : "bg-blue-900"
          }`}
        >
          <span className="text-sm font-semibold opacity-90">
            {!data
              ? "Checking your clock…"
              : open?.stale
                ? "Your last shift needs fixing"
                : open
                  ? "Clocked in"
                  : "Not clocked in"}
          </span>
          <span className="text-[15px] font-bold tabular-nums">
            {open && !open.stale
              ? formatDuration(Math.floor((now.getTime() - Date.parse(open.clockInAt)) / 60000))
              : open?.stale
                ? "Fix it →"
                : "Clock in →"}
          </span>
        </Link>
      )}

      <div className="space-y-2.5">
        {quickLinks(data?.department).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3.5 active:bg-slate-50"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-900">{link.label}</span>
              <span className="block text-xs text-slate-500">{link.sub}</span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        ))}
      </div>

      {(data?.weekMinutes ?? 0) > 0 && (
        <p className="mt-4 text-center text-xs text-slate-400">
          {formatDuration(data!.weekMinutes!)} worked this week
        </p>
      )}
    </div>
  );
}
