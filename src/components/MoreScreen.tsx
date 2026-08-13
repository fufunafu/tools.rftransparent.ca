"use client";

import { cloneElement } from "react";
import Link from "next/link";
import {
  NAV_GROUPS,
  NAV_ITEMS,
  SETTINGS_ITEM,
  filterNavItem,
  type NavItem,
  type ViewerAccess,
} from "@/components/nav-items";

// The full tool list for phones — everything the sidebar shows on desktop,
// filtered by the same access rules, plus account and sign-out.

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="ml-auto w-4 h-4 shrink-0 text-slate-300">
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
  </svg>
);

function ItemRows({ item }: { item: NavItem }) {
  const icon = cloneElement(item.icon, { className: "w-[18px] h-[18px] shrink-0 text-slate-500" });
  return (
    <>
      {item.external ? (
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-800 active:bg-slate-50"
        >
          {icon}
          {item.label}
          <Chevron />
        </a>
      ) : (
        <Link
          href={item.href}
          className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-800 active:bg-slate-50"
        >
          {icon}
          {item.label}
          <Chevron />
        </Link>
      )}
      {item.children?.map((child) =>
        child.external ? (
          <a
            key={child.href}
            href={child.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 py-2.5 pl-[46px] pr-4 text-[13px] text-slate-500 active:bg-slate-50"
          >
            {child.label}
          </a>
        ) : (
          <Link
            key={child.href}
            href={child.href}
            className="flex items-center gap-3 py-2.5 pl-[46px] pr-4 text-[13px] text-slate-500 active:bg-slate-50"
          >
            {child.label}
          </Link>
        ),
      )}
    </>
  );
}

export default function MoreScreen({
  viewerAccess,
  viewerName,
  viewerEmail,
}: {
  viewerAccess: ViewerAccess;
  viewerName: string | null;
  viewerEmail: string;
}) {
  const visibleSettings = filterNavItem(SETTINGS_ITEM, viewerAccess);

  return (
    <div className="space-y-5">
      {/* Profile */}
      <Link
        href="/settings/account"
        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          {initialsFor(viewerName, viewerEmail)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {viewerName ?? viewerEmail}
          </span>
          <span className="block truncate text-xs text-slate-500">{viewerEmail}</span>
        </span>
        <Chevron />
      </Link>

      {NAV_GROUPS.map((group) => {
        const items = NAV_ITEMS
          .map((item) => filterNavItem(item, viewerAccess))
          .filter((item): item is NonNullable<typeof item> => item !== null && item.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id}>
            <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {group.label}
            </p>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {items.map((item) => (
                <ItemRows key={item.href} item={item} />
              ))}
            </div>
          </div>
        );
      })}

      {visibleSettings && (
        <div>
          <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Settings
          </p>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <ItemRows item={visibleSettings} />
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <Link
          href="/bugs"
          className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-slate-800 active:bg-slate-50"
        >
          Report a bug
          <Chevron />
        </Link>
        <a
          href="/api/logout"
          className="block px-4 py-3 text-center text-sm font-bold text-red-600 active:bg-red-50"
        >
          Sign Out
        </a>
      </div>
    </div>
  );
}
