"use client";

import { cloneElement } from "react";
import Link from "next/link";
import { matchesItem, type NavItem } from "@/components/nav-items";

const ExternalArrow = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);

// Only surfaced on children — a section is never half-built on its own.
const WipChip = () => (
  <span className="text-[9px] font-bold uppercase tracking-[0.07em] text-amber-700 bg-amber-50 rounded px-1 py-px">
    WIP
  </span>
);

/**
 * One sidebar section: the parent row plus its children when expanded.
 * Used for both the scrolling nav list and the pinned Settings row.
 */
export default function SidebarNavRow({
  item,
  pathname,
  collapsed,
  expanded,
  onToggle,
  openProblems,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  expanded: boolean;
  onToggle: () => void;
  openProblems: number;
}) {
  const hasChildren = Boolean(item.children?.length);
  const sectionActive = matchesItem(item, pathname);
  const sectionId = `sidebar-section-${item.href.replace(/[^a-z0-9]+/gi, "-")}`;

  // Blue means "this exact page". A section that merely contains the current
  // page goes dark and semibold instead, so the rail has one blue row at a
  // time. Collapsed, a section is the only thing representing its children,
  // so it takes the blue itself.
  const blueActive = collapsed ? sectionActive : sectionActive && !hasChildren;
  const containsActive = !collapsed && hasChildren && sectionActive;

  // Size is picked in one branch rather than layered, so there's never a
  // duplicate height/padding utility whose winner depends on CSS order.
  const rowClass = `group flex items-center gap-[9px] rounded-lg text-[13px] transition-colors ${
    collapsed ? "h-[30px] w-[34px] mx-auto justify-center" : "h-8 px-[9px]"
  } ${
    blueActive
      ? "bg-blue-50 font-semibold text-blue-700"
      : containsActive
        ? "font-semibold text-slate-900 hover:bg-slate-50"
        : "font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
  }`;

  // The icon is authored once in nav-items and restyled here, so size and
  // colour live with the row rather than being repeated on every svg.
  const icon = cloneElement(item.icon, {
    className: `w-4 h-4 shrink-0 ${blueActive ? "text-blue-600" : "text-slate-400"}`,
    strokeWidth: blueActive ? 1.7 : 1.6,
  });

  // Open problem tickets live under Customer Service — the count badge sits
  // on that parent so it stays visible on every page.
  const showBadge = item.href === "/customer-service" && openProblems > 0;
  const badge = showBadge ? (
    <span
      className="min-w-[19px] h-[18px] px-[5px] rounded-full bg-red-500 text-white text-[10.5px] font-semibold tabular-nums flex items-center justify-center"
      title={`${openProblems} open problem ticket${openProblems === 1 ? "" : "s"}`}
    >
      {openProblems}
    </span>
  ) : null;

  const trailing = collapsed ? null : badge;

  return (
    <div>
      {hasChildren && !collapsed ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={sectionId}
          className={`${rowClass} w-full text-left`}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {trailing}
          {/* Points right when shut, down when open — rotating a down-chevron
              would read as "up = open". */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-3 h-3 shrink-0 text-slate-300 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
          </svg>
        </button>
      ) : item.external ? (
        <a
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={rowClass}
          title={collapsed ? item.label : undefined}
        >
          {icon}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <ExternalArrow className="w-3 h-3 text-slate-300" />
            </>
          )}
        </a>
      ) : (
        <Link
          href={hasChildren ? item.children![0].href : item.href}
          className={rowClass}
          title={collapsed ? item.label : undefined}
        >
          {collapsed && showBadge ? (
            <span className="relative flex items-center justify-center">
              {icon}
              {/* No room for the pill in the rail — a corner dot still
                  signals open problem tickets. */}
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
            </span>
          ) : (
            icon
          )}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {trailing}
            </>
          )}
        </Link>
      )}

      {hasChildren && !collapsed && (
        <div
          id={sectionId}
          aria-hidden={!expanded}
          className={`grid transition-[grid-template-rows,opacity] duration-200 ${
            expanded ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            {/* No connector line — at this indent the nesting already reads,
                and the rule was the last thing dragging the eye down the rail. */}
            <div className="flex flex-col gap-px pl-[34px] py-0.5">
              {item.children!.map((child) => {
                const childActive =
                  !child.external && (pathname === child.href || pathname.startsWith(child.href + "/"));
                const childBadge = child.href === "/customer-service/problems" && openProblems > 0;
                const childClass = `flex h-[26px] items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors ${
                  childActive
                    ? "bg-blue-50/60 font-semibold text-blue-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`;
                const childContent = (
                  <>
                    <span className="min-w-0 flex-1 truncate">{child.label}</span>
                    {childBadge ? (
                      // Plain text, not a pill — the parent's pill stays the
                      // loudest thing in the group.
                      <span className="text-[11px] font-semibold text-red-500 tabular-nums">
                        {openProblems}
                      </span>
                    ) : child.external ? (
                      <ExternalArrow className="w-3 h-3 text-slate-300" />
                    ) : child.status === "wip" ? (
                      <WipChip />
                    ) : null}
                  </>
                );
                return child.external ? (
                  <a
                    key={child.href}
                    href={child.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={childClass}
                    tabIndex={expanded ? undefined : -1}
                  >
                    {childContent}
                  </a>
                ) : (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={childClass}
                    tabIndex={expanded ? undefined : -1}
                  >
                    {childContent}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
