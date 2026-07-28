"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import CommandPalette from "@/components/CommandPalette";
import SidebarNavRow from "@/components/SidebarNavRow";
import { NAV_ITEMS, SEARCH_TARGETS, SETTINGS_ITEM, matchesItem, type NavItem } from "@/components/nav-items";

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

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed: rawCollapsed, width, sidebarRef, handleMouseDown, toggleCollapsed } = useSidebarResize();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const modKey = useSyncExternalStore(NEVER_CHANGES, readModKey, noModKey);
  // On phones the drawer always renders expanded (full labels), regardless of
  // the desktop collapse state. Shadowing `collapsed` here means the existing
  // nav markup below is unchanged.
  const collapsed = !isMobile && rawCollapsed;

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
        setMobileOpen(false);
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Click-to-expand state for parent items with children. A parent is open if
  // the user explicitly toggled it open OR the current route lives inside it.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const isSectionOpen = (item: NavItem) =>
    openSections[item.href] ?? matchesItem(item, pathname);
  const toggleSection = (item: NavItem) =>
    setOpenSections((prev) => ({
      ...prev,
      [item.href]: !(prev[item.href] ?? matchesItem(item, pathname)),
    }));

  // Open problem-ticket count for the sidebar badge. Refetched on every
  // client-side navigation so resolving a ticket updates the badge promptly.
  const [openProblems, setOpenProblems] = useState(0);
  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/print/")) return;
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
  if (pathname === "/login" || pathname.startsWith("/print/")) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen">
      {searchOpen && (
        <CommandPalette targets={SEARCH_TARGETS} onClose={() => setSearchOpen(false)} />
      )}

      {/* Mobile backdrop — dims content and closes the drawer on tap */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — in-flow and resizable on desktop; an off-canvas drawer that
          slides in over the content below the md breakpoint. */}
      <aside
        ref={sidebarRef}
        style={{ width }}
        className={`bg-white border-r border-slate-200 flex flex-col z-40 relative
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:!w-72 max-md:shadow-xl
          max-md:transition-transform max-md:duration-200
          ${mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}
          md:shrink-0 md:transition-[width] md:duration-200`}
      >
        {/* Logo + collapse toggle */}
        <div className="px-3 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">RF</span>
          </div>
          {!collapsed && <span className="text-sm font-semibold text-slate-900 flex-1">RF Transparent</span>}
          {/* Desktop: collapse/expand toggle */}
          <button
            onClick={toggleCollapsed}
            className="max-md:hidden w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          {/* Mobile: close the drawer */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Page search — opens the same palette as ⌘K */}
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              setSearchOpen(true);
            }}
            title={collapsed ? "Search pages" : undefined}
            className={`w-full flex items-center gap-2 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors ${
              collapsed ? "justify-center py-2" : "px-3 py-2"
            }`}
          >
            <SearchIcon className="w-4 h-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left text-sm">Search</span>
                {modKey ? <kbd className="text-[11px] font-sans text-slate-300">{modKey}K</kbd> : null}
              </>
            )}
          </button>
        </div>

        {/* Navigation. On mobile, a click on any nav link (not a section
            toggle button) closes the drawer — delegated so we don't thread an
            onClick through every link. */}
        <nav
          className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}
        >
          {NAV_ITEMS.map((item) => (
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
        </nav>

        {/* Settings — pinned above Sign out so admin pages stay out of the
            day-to-day list but never scroll out of reach. */}
        <div
          className="px-2 py-2 border-t border-slate-200"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}
        >
          <SidebarNavRow
            item={SETTINGS_ITEM}
            pathname={pathname}
            collapsed={collapsed}
            expanded={!collapsed && isSectionOpen(SETTINGS_ITEM)}
            onToggle={() => toggleSection(SETTINGS_ITEM)}
            openProblems={openProblems}
          />
        </div>

        {/* Sign out */}
        <div className="px-2 py-4 border-t border-slate-200">
          <a
            href="/api/logout"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            title={collapsed ? "Sign out" : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            </svg>
            {!collapsed && "Sign out"}
          </a>
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
        {/* Mobile top bar — hamburger opens the drawer */}
        <div className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-slate-200 bg-white shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-9 h-9 -ml-1.5 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-bold">RF</span>
          </div>
          <span className="flex-1 text-sm font-semibold text-slate-900">RF Transparent</span>
          {/* Phones have no keyboard shortcut, so search gets its own button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="w-9 h-9 -mr-1.5 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
            aria-label="Search pages"
          >
            <SearchIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-slate-100">
          <div className="p-4 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
