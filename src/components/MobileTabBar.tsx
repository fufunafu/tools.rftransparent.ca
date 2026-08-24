"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// iOS-style bottom tab bar for iPhone and iPad. The desktop sidebar is
// untouched; on touch layouts this replaces the old hamburger drawer, so everything
// that isn't a tab lives one tap away under More.

interface Tab {
  href: string;
  label: string;
  // Path prefixes that light this tab up (defaults to href).
  match?: string[];
  icon: React.ReactElement;
}

function tabs(): Tab[] {
  return [
    {
      href: "/",
      label: "Home",
      match: ["/"],
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
        </svg>
      ),
    },
    {
      href: "/clock",
      label: "Clock",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
    },
    {
      href: "/todos",
      label: "Tasks",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ),
    },
    {
      href: "/more",
      label: "More",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
        </svg>
      ),
    },
  ];
}

function isActive(tab: Tab, pathname: string): boolean {
  return (tab.match ?? [tab.href]).some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex">
        {tabs().map((tab) => {
          const active = isActive(tab, pathname);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-semibold transition-colors ${
                active ? "text-blue-700" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {tab.icon}
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
