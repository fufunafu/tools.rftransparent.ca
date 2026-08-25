"use client";

import { useState } from "react";
import Link from "next/link";
import NativeSettingsPanel from "@/components/NativeSettingsPanel";
import {
  NAV_ITEMS,
  SETTINGS_ITEM,
  filterNavItem,
  type AccessLevel,
  type NavItem,
  type ViewerAccess,
} from "@/components/nav-items";
import { mobileRoleActions } from "@/lib/mobile-home";
import type { MobileRoleAction } from "@/lib/mobile-types";

interface Destination extends MobileRoleAction {
  access?: AccessLevel;
}

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

function destination(item: { href: string; label: string; external?: boolean; access?: AccessLevel }): Destination {
  return {
    id: item.href,
    href: item.href,
    label: item.label,
    description: item.external ? "Opens outside RF Tools" : "Open tool",
    external: item.external,
    access: item.access,
  };
}

function flattenItem(item: NavItem): Destination[] {
  if (item.children?.length) return item.children.map(destination);
  return [destination(item)];
}

function uniqueDestinations(destinations: Destination[]): Destination[] {
  const seen = new Set<string>();
  return destinations.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

function Section({ title, items }: { title: string; items: Destination[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`more-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <h2 id={`more-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
        {title}
      </h2>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {items.map((item) => {
          const content = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">{item.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
              </span>
              <span className="text-lg text-slate-300" aria-hidden="true">{item.external ? "↗" : "›"}</span>
              {item.external && <span className="sr-only">Opens outside RF Tools</span>}
            </>
          );
          const className = "flex min-h-16 items-center gap-3 px-4 py-3 active:bg-slate-50";
          return item.external ? (
            <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className={className}>{content}</a>
          ) : (
            <Link key={item.href} href={item.href} className={className}>{content}</Link>
          );
        })}
      </div>
    </section>
  );
}

export default function MoreScreen({
  viewerAccess,
  viewerName,
  viewerEmail,
  viewerDepartment,
  avatarUrl = null,
}: {
  viewerAccess: ViewerAccess;
  viewerName: string | null;
  viewerEmail: string;
  viewerDepartment: string | null;
  avatarUrl?: string | null;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = avatarUrl && !avatarFailed;
  const role = mobileRoleActions(viewerDepartment);
  const rolePaths = new Set(role.map((item) => item.href));
  const personalRolePaths = new Set(["/sales", "/warehouse/report"]);
  const primaryPaths = new Set(["/", "/clock", "/todos", "/more"]);
  const accountPaths = new Set(["/settings/account", "/bugs"]);

  const visibleNav = NAV_ITEMS
    .map((item) => filterNavItem(item, viewerAccess))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .flatMap(flattenItem);
  const settings = filterNavItem(SETTINGS_ITEM, viewerAccess);
  const management = uniqueDestinations([
    ...visibleNav.filter((item) => item.access === "admin" || item.access === "management"),
    ...(settings ? flattenItem(settings) : []),
  ]).filter(
    (item) =>
      !primaryPaths.has(item.href) &&
      !accountPaths.has(item.href) &&
      !rolePaths.has(item.href),
  );
  const managementPaths = new Set(management.map((item) => item.href));
  const shared = uniqueDestinations(visibleNav).filter(
    (item) =>
      !primaryPaths.has(item.href) &&
      !accountPaths.has(item.href) &&
      !rolePaths.has(item.href) &&
      !personalRolePaths.has(item.href) &&
      !managementPaths.has(item.href),
  );

  return (
    <div className="space-y-5">
      <Section title="Your work" items={role} />
      <Section title="Shared tools" items={shared} />

      <section aria-labelledby="more-account-help">
        <h2 id="more-account-help" className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">Account and help</h2>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Link href="/settings/account" className="flex min-h-16 items-center gap-3 border-b border-slate-100 px-4 py-3 active:bg-slate-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-sm font-bold text-white">
              {showAvatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} className="h-full w-full object-cover" />
              ) : initialsFor(viewerName, viewerEmail)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-slate-900">{viewerName ?? viewerEmail}</span>
              <span className="block truncate text-xs text-slate-500">My account</span>
            </span>
            <span className="text-lg text-slate-300" aria-hidden="true">›</span>
          </Link>
          <Link href="/bugs" className="flex min-h-14 items-center justify-between px-4 py-3 text-sm font-bold text-slate-900 active:bg-slate-50">
            Report a bug <span className="text-lg text-slate-300" aria-hidden="true">›</span>
          </Link>
          <Link href="/support" className="flex min-h-14 items-center justify-between border-t border-slate-100 px-4 py-3 text-sm font-bold text-slate-900 active:bg-slate-50">
            Support <span className="text-lg text-slate-300" aria-hidden="true">›</span>
          </Link>
          <Link href="/privacy" className="flex min-h-14 items-center justify-between border-t border-slate-100 px-4 py-3 text-sm font-bold text-slate-900 active:bg-slate-50">
            Privacy <span className="text-lg text-slate-300" aria-hidden="true">›</span>
          </Link>
        </div>
      </section>

      <NativeSettingsPanel />

      {(viewerAccess.isManagement || viewerAccess.isAdmin) && <Section title="Management" items={management} />}

      <a href="/api/logout" className="flex min-h-12 items-center justify-center rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-bold text-red-700 active:bg-red-50">
        Sign out
      </a>
    </div>
  );
}
