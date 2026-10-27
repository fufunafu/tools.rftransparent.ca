"use client";

/* Profile photos come from an authenticated route and cannot use the image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { Fragment, useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import CommandPalette from "@/components/CommandPalette";
import MobileTabBar from "@/components/MobileTabBar";
import SidebarNavRow from "@/components/SidebarNavRow";
import {
  applyAccountPreferences,
  sanitizeAccountPreferences,
  type AccountPreferences,
} from "@/lib/account-preferences";
import {
  NAV_GROUPS,
  NAV_ITEMS,
  SETTINGS_ITEM,
  filterNavItem,
  getSearchTargets,
  matchesItem,
  type NavItem,
  type NavSection,
  type ViewerAccess,
} from "@/components/nav-items";

// Shortcut hint for the search box. The platform is only knowable on the
// client, so the server renders nothing and hydration fills it in — no
// mismatch, and no "Ctrl" flashing on a Mac.
const NEVER_CHANGES = () => () => {};
const readModKey = () => (/Mac|iPhone|iPad/i.test(navigator.userAgent) ? "⌘" : "Ctrl ");
const noModKey = () => "";

const SearchIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);

const COLLAPSIBLE_ITEMS: NavItem[] = [...NAV_ITEMS, SETTINGS_ITEM].filter(
  (item) => item.children?.length,
);

function sectionForPathname(pathname: string) {
  return COLLAPSIBLE_ITEMS.find((item) => matchesItem(item, pathname))?.href ?? null;
}

function usesStandaloneLayout(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/support" ||
    pathname.startsWith("/print/") ||
    pathname.startsWith("/survey/") ||
    pathname.startsWith("/wall/")
  );
}

const BugIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 8.5a4 4 0 0 1 8 0v4a4 4 0 0 1-8 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5H4.5M19.5 10.5H16M8.5 5.5 6 3.5M15.5 5.5 18 3.5M8 15l-2.5 2.5M16 15l2.5 2.5M12 16.5v4" />
  </svg>
);

const SignOutIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
  </svg>
);

/** "Anne Gao" -> "AG"; falls back to the email when there's no name. */
function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

function ViewerAvatar({
  name,
  email,
  avatarUrl,
}: {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}) {
  const label = name || email || "Signed-in user";
  // Google-hosted avatar URLs go stale; fall back to initials when one 404s.
  const [failed, setFailed] = useState(false);
  return (
    <span
      role="img"
      aria-label={`${label} profile`}
      className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[10.5px] font-bold text-slate-600"
    >
      {avatarUrl && !failed ? (
        <img src={avatarUrl} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        initialsFor(name, email)
      )}
    </span>
  );
}

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    collapsed: rawCollapsed,
    width,
    sidebarRef,
    handleMouseDown,
    toggleCollapsed,
    setCollapsed,
  } = useSidebarResize(240);
  const [isMobile, setIsMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewerAccess, setViewerAccess] = useState<ViewerAccess>({
    isAdmin: false,
    isManagement: false,
  });
  const [viewer, setViewer] = useState<{
    name: string | null;
    email: string;
    avatarUrl: string | null;
  }>({
    name: null,
    email: "",
    avatarUrl: null,
  });
  // Concrete paths, never the "auto" sentinel — resolved values arrive from
  // /api/admin/me. dashboardPath is where the sidebar's Dashboard entry goes.
  const [homePath, setHomePath] = useState("/");
  const [dashboardPath, setDashboardPath] = useState("/");
  const preferencesApplied = useRef(false);
  const modKey = useSyncExternalStore(NEVER_CHANGES, readModKey, noModKey);
  // On phones the drawer always renders expanded (full labels), regardless of
  // the desktop collapse state. Shadowing `collapsed` here means the existing
  // nav markup below is unchanged.
  const collapsed = !isMobile && rawCollapsed;
  const visibleNavItems = NAV_ITEMS
    .map((item) => filterNavItem(item, viewerAccess))
    .filter((item): item is NavSection => item !== null)
    // The Dashboard entry opens the viewer's own dashboard; its `match` list
    // keeps it highlighted on every dashboard route either way.
    .map((item) => (item.href === "/" ? { ...item, href: dashboardPath } : item));
  const visibleSettings = filterNavItem(SETTINGS_ITEM, viewerAccess);
  const searchTargets = getSearchTargets(
    visibleSettings ? [...visibleNavItems, visibleSettings] : visibleNavItems,
  );
  const mobileHomePath = "/";
  const tabRoot = [mobileHomePath, "/clock", "/todos", "/more"].includes(pathname);
  const detailTitle = searchTargets
    .filter((target) => !target.external && (pathname === target.href || pathname.startsWith(`${target.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label
    ?? pathname.split("/").filter(Boolean).at(-1)?.replace(/-/g, " ")
    ?? "RF Tools";

  // Keep the touch-first shell through iPad portrait and landscape widths.
  // The widest supported iPad viewport is 1194 points, so the desktop rail
  // begins at Tailwind's xl breakpoint instead of lg.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ⌘K / Ctrl-K opens the page search from anywhere in the app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // One shared value gives the navigation true accordion behavior: opening a
  // section always closes the previous one. Route changes open the section
  // containing the destination so the current page remains easy to locate.
  const [openSection, setOpenSection] = useState<string | null>(() => sectionForPathname(pathname));
  useEffect(() => {
    setOpenSection(sectionForPathname(pathname));
  }, [pathname]);

  useEffect(() => {
    if (usesStandaloneLayout(pathname)) return;
    const ctrl = new AbortController();
    fetch("/api/admin/me", { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (!me) return;
        const preferences = sanitizeAccountPreferences(me.preferences);
        setViewerAccess({
          isAdmin: me.isAdmin === true,
          isManagement: me.isManagement === true,
          canAccessCrm: me.canAccessCrm === true,
        });
        setViewer({
          name: typeof me.name === "string" ? me.name : null,
          email: typeof me.email === "string" ? me.email : "",
          avatarUrl: typeof me.avatarUrl === "string" ? me.avatarUrl : null,
        });
        setHomePath(
          typeof me.resolvedHomePage === "string"
            ? me.resolvedHomePage
            : preferences.homePage === "auto"
              ? "/"
              : preferences.homePage
        );
        setDashboardPath(typeof me.resolvedDashboard === "string" ? me.resolvedDashboard : "/");
        applyAccountPreferences(preferences);
        if (!preferencesApplied.current) {
          setCollapsed(preferences.sidebarMode === "compact");
          preferencesApplied.current = true;
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [pathname, setCollapsed]);

  useEffect(() => {
    const onAccountUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{
        displayName?: unknown;
        avatarUrl?: unknown;
        preferences?: AccountPreferences;
      }>).detail;
      if (!detail) return;

      const updatedName = detail.displayName;
      if (typeof updatedName === "string" && updatedName.trim()) {
        setViewer((current) => ({ ...current, name: updatedName.trim() }));
      }
      if (detail.avatarUrl === null || typeof detail.avatarUrl === "string") {
        setViewer((current) => ({ ...current, avatarUrl: detail.avatarUrl as string | null }));
      }

      const preferences = sanitizeAccountPreferences(detail.preferences);
      if (preferences.dashboard !== "auto") setDashboardPath(preferences.dashboard);
      if (preferences.homePage !== "auto") setHomePath(preferences.homePage);
      if (preferences.homePage === "auto" || preferences.dashboard === "auto") {
        // The client can't derive the role default itself — ask the probe.
        fetch("/api/admin/me")
          .then((res) => (res.ok ? res.json() : null))
          .then((me) => {
            if (typeof me?.resolvedHomePage === "string") setHomePath(me.resolvedHomePage);
            if (typeof me?.resolvedDashboard === "string") setDashboardPath(me.resolvedDashboard);
          })
          .catch(() => {});
      }
      setCollapsed(preferences.sidebarMode === "compact");
      applyAccountPreferences(preferences);
      preferencesApplied.current = true;
    };

    window.addEventListener("rf:account-updated", onAccountUpdated);
    return () => window.removeEventListener("rf:account-updated", onAccountUpdated);
  }, [setCollapsed]);
  const isSectionOpen = (item: NavItem) => openSection === item.href;
  const toggleSection = (item: NavItem) =>
    setOpenSection((current) => (current === item.href ? null : item.href));

  // Open problem-ticket count for the sidebar badge. Refetched on every
  // client-side navigation so resolving a ticket updates the badge promptly.
  const [openProblems, setOpenProblems] = useState(0);
  useEffect(() => {
    if (usesStandaloneLayout(pathname)) return;
    let cancelled = false;
    fetch("/api/problems/count", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json && typeof json.open === "number") setOpenProblems(json.open);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // No sidebar on the login page, or on print-friendly routes (PO printouts
  // open in a new tab and shouldn't carry the app chrome).
  if (usesStandaloneLayout(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden">
      {searchOpen && (
        <CommandPalette targets={searchTargets} onClose={() => setSearchOpen(false)} />
      )}

      {/* Sidebar — in-flow and resizable on desktop. Below the md breakpoint
          it stays off-canvas: phones navigate with the bottom tab bar and the
          More page instead of a drawer. */}
      <aside
        ref={sidebarRef}
        style={{ width }}
        className="min-h-0 bg-white border-r border-slate-300 flex-col z-40 relative hidden xl:flex
          md:shrink-0 md:transition-[width] md:duration-200"
      >
        {/* Logo and collapse controls */}
        {/* Shut, the two sit one above the other. Side by side they needed
            more width than the rail has, and the button was being pushed off
            its own edge. */}
        <div className={`px-3 pt-3 pb-2.5 flex ${collapsed ? "flex-col items-center gap-2" : "items-center gap-2.5"}`}>
          <Link
            href={homePath}
            title={collapsed ? "Go to your home page" : undefined}
            className={`flex min-w-0 items-center gap-2.5 ${collapsed ? "" : "flex-1"}`}
          >
            <span className="w-[28px] h-[28px] rounded-[8px] bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-white text-[11px] font-bold tracking-[0.02em]">RF</span>
            </span>
            {!collapsed && (
              <span className="flex-1 min-w-0 truncate text-[13.5px] font-semibold text-slate-900">
                RF Transparent
              </span>
            )}
          </Link>
          {/* Desktop: collapse/expand toggle. It was a 22px chevron in
              slate-300, which is 1.1 to 1 against white: the one control that
              changes the shape of the whole screen, and you had to know it was
              there. A bordered button at 28px, with a 2px stroke, is findable
              without being loud. */}
          <button
            onClick={toggleCollapsed}
            className="max-md:hidden w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center
              text-slate-500 hover:text-slate-900 hover:border-slate-400 hover:bg-slate-50 transition-colors shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-[15px] h-[15px] transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 19.5 7 12l7.5-7.5" />
              <path strokeLinecap="round" d="M18.5 4.75v14.5" />
            </svg>
          </button>
        </div>

        {/* Page search — opens the same palette as ⌘K */}
        <div className="px-3 pb-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title={collapsed ? "Search pages" : undefined}
            className={`h-[34px] flex items-center gap-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors ${
              collapsed ? "w-10 mx-auto justify-center" : "w-full px-[10px]"
            }`}
          >
            <SearchIcon className="w-4 h-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-[12.5px]">Search</span>
                {modKey ? (
                  <kbd className="font-sans text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded px-[5px] py-px">
                    {modKey}K
                  </kbd>
                ) : null}
              </>
            )}
          </button>
        </div>

        <nav
          className="flex-1 px-3 pt-1 pb-2 overflow-y-auto flex flex-col gap-0.5"
          aria-label="Main navigation"
        >
          {NAV_GROUPS.map((group, groupIndex) => {
            const items = visibleNavItems.filter((item) => item.group === group.id);
            if (items.length === 0) return null;
            return (
              <Fragment key={group.id}>
                {collapsed
                  ? // No room for a label, so a rule carries the grouping. Full
                    // width rather than a 24px stub: a short line floating in
                    // the middle of the rail reads as a stray mark.
                    groupIndex > 0 && <span className="my-2 h-px bg-slate-200" />
                  : (
                    // The label was slate-300, which is 1.6 to 1 against white.
                    // Five headings nobody could read is the same as no
                    // headings at all, so the rail was one list of thirteen.
                    // slate-500 reads, and a rule above each band says where
                    // one ends without the label having to shout.
                    <p
                      className={`${
                        groupIndex === 0 ? "mt-1.5" : "mt-3 pt-3 border-t border-slate-200"
                      } mb-1 px-[10px] text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500`}
                    >
                      {group.label}
                    </p>
                  )}
                {items.map((item) => (
                  <SidebarNavRow
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    collapsed={collapsed}
                    expanded={Boolean(item.children?.length) && !collapsed && isSectionOpen(item)}
                    onToggle={() => toggleSection(item)}
                    openProblems={openProblems}
                  />
                ))}
              </Fragment>
            );
          })}
        </nav>

        {/* One footer block: Settings, then the way to report a bug, then who
            you're signed in as. Signing out still hangs off the identity row,
            which is where somebody looks for it. */}
        <div className="px-3 pt-2 pb-2.5 border-t border-slate-200 flex flex-col gap-1">
          {visibleSettings && (
            <SidebarNavRow
              item={visibleSettings}
              pathname={pathname}
              collapsed={collapsed}
              expanded={!collapsed && isSectionOpen(visibleSettings)}
              onToggle={() => toggleSection(visibleSettings)}
              openProblems={openProblems}
            />
          )}

          {/* Reporting a bug was four words of slate-300 tucked under the
              name, at 10px: the one thing in here somebody reaches for when
              the app is misbehaving, drawn as the quietest thing on the
              screen. It is a button now, on its own line, where it can be
              found by somebody who is already annoyed. */}
          <Link
            href="/bugs"
            title={collapsed ? "Report a bug" : undefined}
            aria-label={collapsed ? "Report a bug" : undefined}
            className={`h-[32px] flex items-center gap-2 rounded-lg border text-[12.5px] font-medium transition-colors ${
              collapsed ? "w-10 mx-auto justify-center" : "w-full px-[10px]"
            } ${
              pathname === "/bugs"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            <BugIcon className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Report a bug</span>}
          </Link>

          {collapsed ? (
            // Stacked rather than avatar-only: there's no avatar menu to hide
            // sign-out behind, and needing to expand the rail to sign out is a
            // worse trade than one more row.
            <div className="mt-0.5 flex flex-col items-center gap-1">
              <ViewerAvatar
                name={viewer.name}
                email={viewer.email}
                avatarUrl={viewer.avatarUrl}
              />
              <a
                href="/api/logout"
                title="Sign out"
                aria-label="Sign out"
                className="w-10 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <SignOutIcon className="w-[16px] h-[16px]" />
              </a>
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-2.5 h-[38px] pl-[10px] pr-[5px]">
              <ViewerAvatar
                name={viewer.name}
                email={viewer.email}
                avatarUrl={viewer.avatarUrl}
              />
              {/* The line under the name is the account you are signed in as,
                  which is the question somebody actually has when they look
                  down here on a shared machine. */}
              <span className="flex-1 min-w-0 flex flex-col leading-[1.3]">
                <span className="truncate text-[12.5px] font-semibold text-slate-900">
                  {viewer.name ?? viewer.email ?? ""}
                </span>
                {viewer.name && viewer.email ? (
                  <span className="truncate text-[10.5px] text-slate-500">{viewer.email}</span>
                ) : null}
              </span>
              <a
                href="/api/logout"
                title="Sign out"
                aria-label="Sign out"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
              >
                <SignOutIcon className="w-[16px] h-[16px]" />
              </a>
            </div>
          )}
        </div>
        {/* Resize handle — desktop only (drag is mouse-driven) */}
        {!collapsed && (
          <div
            onMouseDown={handleMouseDown}
            className="max-md:hidden absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors"
          />
        )}
      </aside>

      {/* Main column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Tab roots keep the compact brand. Detail screens expose title and Back. */}
        <div className="xl:hidden flex items-center gap-3 min-h-14 px-4 pt-[env(safe-area-inset-top)] border-b border-slate-200 bg-white shrink-0">
          {tabRoot ? (
            <Link href={mobileHomePath} className="flex min-h-11 flex-1 items-center gap-3 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-blue-700 flex items-center justify-center shrink-0">
                <span className="text-white text-[10px] font-bold">RF</span>
              </span>
              <span className="truncate text-sm font-semibold text-slate-900">RF Transparent</span>
            </Link>
          ) : (
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => window.history.length > 1 ? router.back() : router.push(mobileHomePath)}
                className="-ml-2 flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-bold text-blue-600 active:bg-blue-50"
                aria-label={`Back from ${detailTitle}`}
              >
                <span aria-hidden="true">‹</span> Back
              </button>
              <span className="truncate text-sm font-bold capitalize text-slate-900">{detailTitle}</span>
            </div>
          )}
          {/* Phones have no keyboard shortcut, so search gets its own button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="min-h-11 min-w-11 -mr-2 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Search pages"
          >
            <SearchIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Main content. Extra bottom padding on phones keeps the last of the
            page above the fixed tab bar. */}
        <main data-app-main className="min-h-0 flex-1 overflow-y-auto overscroll-y-none bg-slate-100">
          <div className="p-4 pb-28 xl:p-8">
            {children}
          </div>
        </main>

        <MobileTabBar />
      </div>
    </div>
  );
}
