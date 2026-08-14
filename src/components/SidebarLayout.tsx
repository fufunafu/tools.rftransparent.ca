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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className}>
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
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white border border-[#A2B5BD] text-[10px] font-bold text-[#3F5057]"
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

  // The collapse control. It used to sit beside the logo, where at 56px of rail
  // there was room for one of the two and they landed on top of each other.
  // Down here it has the footer to itself, and it is the one blue thing in the
  // rail because it is the one control that changes the rail rather than
  // navigating it.
  const foldButton = (
    <button
      onClick={toggleCollapsed}
      className="max-md:hidden w-8 h-8 shrink-0 rounded-[7px] flex items-center justify-center
        bg-[#3E6E96] text-white shadow-[0_1px_2px_rgba(18,23,26,.12),0_6px_14px_-8px_rgba(62,110,150,.7)]
        hover:bg-[#33597A] active:translate-y-px transition-colors"
      title={collapsed ? "Expand the menu" : "Collapse the menu"}
      aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        className={`w-[15px] h-[15px] transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
    </button>
  );

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
        className="min-h-0 bg-[#F7F9FA] border-r border-[#A2B5BD] flex-col z-40 relative hidden md:flex
          md:shrink-0 md:transition-[width] md:duration-200"
      >
        {/* The brand lockup, and nothing else — see foldButton. */}
        <div className={`min-h-16 flex items-center ${collapsed ? "justify-center px-2" : "gap-[11px] px-4"}`}>
          <Link
            href={homePath}
            title={collapsed ? "Go to your home page" : undefined}
            className={`group flex min-w-0 items-center gap-[11px] ${collapsed ? "" : "flex-1"}`}
          >
            <span className="w-[34px] h-[34px] rounded-[9px] bg-[#3E6E96] group-hover:bg-[#33597A] transition-colors flex items-center justify-center shrink-0">
              <span className="text-white text-[11px] font-bold tracking-[0.02em]">RF</span>
            </span>
            {!collapsed && (
              <span className="flex min-w-0 flex-col gap-[4px] leading-none">
                <b className="truncate text-[15.5px] font-semibold tracking-[-0.035em] text-[#12171A]">
                  RF Transparent
                </b>
                <span className="text-[8.5px] font-semibold uppercase tracking-[0.17em] text-[#68757B]">
                  Internal Tools
                </span>
              </span>
            )}
          </Link>
        </div>

        {/* Page search — opens the same palette as ⌘K */}
        <div className={`pb-2 ${collapsed ? "px-2" : "px-3"}`}>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title={collapsed ? "Search pages" : undefined}
            className={`w-full h-8 flex items-center gap-2 rounded-[7px] bg-white border border-[#A2B5BD]
              text-[#5A686E] hover:border-[#3F5057] hover:text-[#12171A] transition-colors ${
              collapsed ? "justify-center" : "px-[10px]"
            }`}
          >
            <SearchIcon className="w-[15px] h-[15px] shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-[12.5px] font-medium">Search</span>
                {modKey ? (
                  <kbd className="font-sans text-[10px] font-semibold text-[#68757B]">{modKey}K</kbd>
                ) : null}
              </>
            )}
          </button>
        </div>

        <nav
          className={`flex-1 pt-1 pb-2 overflow-y-auto flex flex-col gap-0.5 ${collapsed ? "px-2" : "px-3"}`}
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
                    groupIndex > 0 && <span className="my-2 h-px w-7 mx-auto bg-[#A2B5BD]" />
                  : (
                    <p
                      className={`${groupIndex === 0 ? "pt-1.5" : "pt-4"} pb-[7px] px-[10px] text-[9px] font-semibold uppercase tracking-[0.17em] text-[#68757B] whitespace-nowrap`}
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

        {/* One footer block: Settings, then who you're signed in as, then the
            control that folds the rail. Reporting a bug and signing out hang
            off the identity row rather than taking a full-width strip each. */}
        <div className={`pt-2 pb-2.5 border-t border-[#A2B5BD] flex flex-col gap-0.5 ${collapsed ? "px-2" : "px-3"}`}>
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
            // worse trade than one more row.
            <div className="mt-1.5 flex flex-col items-center gap-1.5">
              <ViewerAvatar
                name={viewer.name}
                email={viewer.email}
                avatarUrl={viewer.avatarUrl}
              />
              <a
                href="/api/logout"
                title="Sign out"
                aria-label="Sign out"
                className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[#5A686E] hover:text-[#12171A] hover:bg-[rgba(18,23,26,.045)] transition-colors"
              >
                <SignOutIcon className="w-[16px] h-[16px]" />
              </a>
              {foldButton}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 h-[38px] pl-[11px] pr-[5px]">
                <ViewerAvatar
                  name={viewer.name}
                  email={viewer.email}
                  avatarUrl={viewer.avatarUrl}
                />
                <span className="flex-1 min-w-0 flex flex-col leading-[1.25]">
                  <span className="truncate text-[12px] font-semibold text-[#12171A]">
                    {viewer.name ?? viewer.email ?? ""}
                  </span>
                  <Link
                    href="/bugs"
                    className={`text-[10px] w-fit font-medium transition-colors ${
                      pathname === "/bugs"
                        ? "text-[#12171A]"
                        : "text-[#68757B] hover:text-[#12171A]"
                    }`}
                  >
                    Report a bug
                  </Link>
                </span>
                <a
                  href="/api/logout"
                  title="Sign out"
                  aria-label="Sign out"
                  className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[#5A686E] hover:text-[#12171A] hover:bg-[rgba(18,23,26,.045)] transition-colors shrink-0"
                >
                  <SignOutIcon className="w-[16px] h-[16px]" />
                </a>
              </div>
              <div className="flex items-center justify-end pt-1">{foldButton}</div>
            </>
          )}
        </div>
        {/* Resize handle — desktop only (drag is mouse-driven) */}
        {!collapsed && (
          <div
            onMouseDown={handleMouseDown}
            className="max-md:hidden absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#3E6E96] active:bg-[#33597A] transition-colors"
          />
        )}
      </aside>

      {/* Main column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile top bar — brand and search. Navigation lives in the bottom
            tab bar. The top safe-area padding clears the notch when the site
            runs full-screen (home-screen install or the iOS app). */}
        <div className="md:hidden flex items-center gap-3 min-h-14 px-4 pt-[env(safe-area-inset-top)] border-b border-[#A2B5BD] bg-white shrink-0">
          <Link href={homePath} className="flex items-center gap-3 flex-1 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-[#3E6E96] flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-bold">RF</span>
            </span>
            <span className="truncate text-sm font-semibold text-[#12171A]">RF Transparent</span>
          </Link>
          {/* Phones have no keyboard shortcut, so search gets its own button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="w-9 h-9 -mr-1.5 rounded-md flex items-center justify-center text-[#3F5057] hover:bg-[rgba(18,23,26,.045)] transition-colors"
            aria-label="Search pages"
          >
            <SearchIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Main content. Extra bottom padding on phones keeps the last of the
            page above the fixed tab bar. */}
        <main data-app-main className="min-h-0 flex-1 overflow-y-auto overscroll-y-none bg-[#F1F4F5]">
          <div className="p-4 pb-28 md:p-8">
            {children}
          </div>
        </main>

        <MobileTabBar homePath={homePath} />
      </div>
    </div>
  );
}
