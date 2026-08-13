"use client";

/* Profile photos come from an authenticated route and cannot use the image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { Fragment, useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  return (
    <span
      role="img"
      aria-label={`${label} profile`}
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[10px] font-bold text-slate-600"
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsFor(name, email)
      )}
    </span>
  );
}

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
  // A concrete path, never the "auto" sentinel — the resolved value arrives
  // from /api/admin/me.
  const [homePath, setHomePath] = useState("/");
  const preferencesApplied = useRef(false);
  const modKey = useSyncExternalStore(NEVER_CHANGES, readModKey, noModKey);
  // On phones the drawer always renders expanded (full labels), regardless of
  // the desktop collapse state. Shadowing `collapsed` here means the existing
  // nav markup below is unchanged.
  const collapsed = !isMobile && rawCollapsed;
  const visibleNavItems = NAV_ITEMS
    .map((item) => filterNavItem(item, viewerAccess))
    .filter((item): item is NavSection => item !== null);
  const visibleSettings = filterNavItem(SETTINGS_ITEM, viewerAccess);
  const searchTargets = getSearchTargets(
    visibleSettings ? [...visibleNavItems, visibleSettings] : visibleNavItems,
  );

  // Track viewport (below Tailwind's md breakpoint = phone/small tablet).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
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
    if (
      pathname === "/login" ||
      pathname.startsWith("/print/") ||
      pathname.startsWith("/survey/") ||
      // The wall board is a chrome-less TV display — no sidebar, no top bar.
      pathname.startsWith("/wall/")
    ) return;
    const ctrl = new AbortController();
    fetch("/api/admin/me", { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (!me) return;
        const preferences = sanitizeAccountPreferences(me.preferences);
        setViewerAccess({
          isAdmin: me.isAdmin === true,
          isManagement: me.isManagement === true,
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
      if (preferences.homePage === "auto") {
        // The client can't derive the role default itself — ask the probe.
        fetch("/api/admin/me")
          .then((res) => (res.ok ? res.json() : null))
          .then((me) => {
            setHomePath(typeof me?.resolvedHomePage === "string" ? me.resolvedHomePage : "/");
          })
          .catch(() => setHomePath("/"));
      } else {
        setHomePath(preferences.homePage);
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
    if (
      pathname === "/login" ||
      pathname.startsWith("/print/") ||
      pathname.startsWith("/survey/") ||
      // The wall board is a chrome-less TV display — no sidebar, no top bar.
      pathname.startsWith("/wall/")
    ) return;
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
  if (
    pathname === "/login" ||
    pathname.startsWith("/print/") ||
    pathname.startsWith("/survey/") ||
    // The wall board is a chrome-less TV display — it must fill 1920×1080
    // edge to edge with no sidebar and no top bar.
    pathname.startsWith("/wall/")
  ) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen">
      {searchOpen && (
        <CommandPalette targets={searchTargets} onClose={() => setSearchOpen(false)} />
      )}

      {/* Sidebar — in-flow and resizable on desktop. Below the md breakpoint
          it stays off-canvas: phones navigate with the bottom tab bar and the
          More page instead of a drawer. */}
      <aside
        ref={sidebarRef}
        style={{ width }}
        className="bg-white border-r border-slate-200 flex-col z-40 relative hidden md:flex
          md:shrink-0 md:transition-[width] md:duration-200"
      >
        {/* Logo and collapse controls */}
        <div className="px-3 pt-3 pb-2.5 flex items-center gap-2.5">
          <Link
            href={homePath}
            title={collapsed ? "Go to your home page" : undefined}
            className={`flex min-w-0 items-center gap-2.5 ${collapsed ? "" : "flex-1"}`}
          >
            <span className="w-[26px] h-[26px] rounded-[7px] bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-white text-[10.5px] font-bold tracking-[0.02em]">RF</span>
            </span>
            {!collapsed && (
              <span className="flex-1 min-w-0 truncate text-[13px] font-semibold text-slate-900">
                RF Transparent
              </span>
            )}
          </Link>
          {/* Desktop: collapse/expand toggle */}
          <button
            onClick={toggleCollapsed}
            className="max-md:hidden w-[22px] h-[22px] rounded-md flex items-center justify-center text-slate-300 hover:text-slate-600 transition-colors shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* Page search — opens the same palette as ⌘K */}
        <div className="px-3 pb-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title={collapsed ? "Search pages" : undefined}
            className={`w-full h-[30px] flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 hover:border-slate-200 hover:text-slate-600 transition-colors ${
              collapsed ? "justify-center" : "px-[9px]"
            }`}
          >
            <SearchIcon className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-[12.5px]">Search</span>
                {modKey ? (
                  <kbd className="font-sans text-[10px] text-slate-300">{modKey}K</kbd>
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
                  ? // No room for a label — a hairline keeps the grouping
                    // legible in the rail.
                    groupIndex > 0 && <span className="my-1.5 h-px w-6 mx-auto bg-slate-100" />
                  : (
                    <p
                      className={`${groupIndex === 0 ? "mt-2" : "mt-3"} mb-[3px] px-[9px] text-[9.5px] font-semibold uppercase tracking-[0.13em] text-slate-300`}
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

        {/* One footer block: Settings, then who you're signed in as. Reporting
            a bug and signing out hang off the identity row rather than taking
            a full-width strip each. */}
        <div className="px-3 pt-2 pb-2.5 border-t border-slate-100 flex flex-col gap-0.5">
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

          {collapsed ? (
            // Stacked rather than avatar-only: there's no avatar menu to hide
            // sign-out behind, and needing to expand the rail to sign out is a
            // worse trade than one more 26px row.
            <div className="mt-1.5 flex flex-col items-center gap-1">
              <ViewerAvatar
                name={viewer.name}
                email={viewer.email}
                avatarUrl={viewer.avatarUrl}
              />
              <a
                href="/api/logout"
                title="Sign out"
                aria-label="Sign out"
                className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <SignOutIcon className="w-[15px] h-[15px]" />
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 h-[38px] pl-[9px] pr-[5px]">
              <ViewerAvatar
                name={viewer.name}
                email={viewer.email}
                avatarUrl={viewer.avatarUrl}
              />
              <span className="flex-1 min-w-0 flex flex-col leading-[1.25]">
                <span className="truncate text-xs font-semibold text-slate-900">
                  {viewer.name ?? viewer.email ?? ""}
                </span>
                <Link
                  href="/bugs"
                  className={`text-[10px] w-fit transition-colors ${
                    pathname === "/bugs"
                      ? "text-slate-600 font-medium"
                      : "text-slate-300 hover:text-slate-500"
                  }`}
                >
                  Report a bug
                </Link>
              </span>
              <a
                href="/api/logout"
                title="Sign out"
                aria-label="Sign out"
                className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
              >
                <SignOutIcon className="w-[15px] h-[15px]" />
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
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar — brand and search. Navigation lives in the bottom
            tab bar. The top safe-area padding clears the notch when the site
            runs full-screen (home-screen install or the iOS app). */}
        <div className="md:hidden flex items-center gap-3 min-h-14 px-4 pt-[env(safe-area-inset-top)] border-b border-slate-200 bg-white shrink-0">
          <Link href={homePath} className="flex items-center gap-3 flex-1 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-bold">RF</span>
            </span>
            <span className="truncate text-sm font-semibold text-slate-900">RF Transparent</span>
          </Link>
          {/* Phones have no keyboard shortcut, so search gets its own button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="w-9 h-9 -mr-1.5 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Search pages"
          >
            <SearchIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Main content. Extra bottom padding on phones keeps the last of the
            page above the fixed tab bar. */}
        <main data-app-main className="flex-1 overflow-auto bg-slate-100">
          <div className="p-4 pb-28 md:p-8">
            {children}
          </div>
        </main>

        <MobileTabBar homePath={homePath} />
      </div>
    </div>
  );
}
