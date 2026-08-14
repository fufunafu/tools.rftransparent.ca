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
  <span className="text-[9px] font-bold uppercase tracking-[0.07em] text-amber-800 bg-amber-100 border border-amber-300 rounded px-1 py-px">
    WIP
  </span>
);

const FALLBACK_TINT = "#5A6B73";

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
  const tint = item.tint ?? FALLBACK_TINT;

  // The live page rises out of the rail on a white card. A section that merely
  // contains the current page goes dark and semibold instead, so one row at a
  // time is lifted. Collapsed, a section is the only thing representing its
  // children, so it takes the card itself.
  const liveRow = collapsed ? sectionActive : sectionActive && !hasChildren;
  const containsActive = !collapsed && hasChildren && sectionActive;

  // Size is picked in one branch rather than layered, so there's never a
  // duplicate height/padding utility whose winner depends on CSS order.
  const rowClass = `group relative flex items-center gap-[11px] rounded-[7px] text-[13px] tracking-[0.005em] transition-colors ${
    collapsed ? "h-10 w-10 mx-auto justify-center" : "h-10 px-[11px]"
  } ${
    liveRow
      ? "bg-white font-semibold text-[#12171A] shadow-[0_1px_2px_rgba(18,23,26,.05),0_6px_16px_-10px_rgba(18,23,26,.3)]"
      : containsActive
        ? "font-semibold text-[#12171A] hover:bg-[rgba(18,23,26,.045)]"
        : "font-medium text-[#5A686E] hover:bg-[rgba(18,23,26,.045)] hover:text-[#12171A]"
  }`;

  // The icon is authored once in nav-items and restyled here, so size and
  // colour live with the row rather than being repeated on every svg. It wears
  // the section's own colour at all times — dimmed until the row is live or
  // under the cursor, never grey.
  const icon = cloneElement(item.icon, {
    className: `w-[19px] h-[19px] shrink-0 transition-opacity ${liveRow ? "opacity-100" : "opacity-[.62] group-hover:opacity-100"}`,
    strokeWidth: 1.7,
    style: { color: tint },
  });

  // The bar down the left edge of the live row, in the section's colour.
  const liveBar = liveRow ? (
    <span
      aria-hidden
      className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-[2px]"
      style={{ background: `linear-gradient(180deg,transparent,${tint} 20%,${tint} 80%,transparent)` }}
    />
  ) : null;

  // Open problem tickets live under Customer Service — the count badge sits
  // on that parent so it stays visible on every page.
  const showBadge = item.href === "/customer-service" && openProblems > 0;
  const badge = showBadge ? (
    <span
      className="min-w-[18px] h-[18px] px-[5px] rounded-[9px] bg-[#B4462A] text-white text-[10px] font-bold leading-[18px] text-center shrink-0"
      title={`${openProblems} open problem ticket${openProblems === 1 ? "" : "s"}`}
    >
      {openProblems}
    </span>
  ) : null;

  const trailing = collapsed ? null : badge;

  // Where a row without a chevron points. A section collapsed to the icon rail
  // has no way to expand, so it stands in for its first child — and it has to
  // borrow that child's link kind too, or a static destination would go back
  // through the router the moment the rail was narrowed.
  const linkTarget = hasChildren ? item.children![0] : item;

  // Shared by the two link branches below, so the badge-in-the-rail treatment
  // is written once.
  const rowInner = (
    <>
      {liveBar}
      {collapsed && showBadge ? (
        <span className="relative flex items-center justify-center">
          {icon}
          {/* No room for the pill in the rail — a corner dot still
              signals open problem tickets. */}
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#B4462A] ring-2 ring-[#F7F9FA]" />
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
    </>
  );

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
          {liveBar}
          {icon}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {trailing}
          {/* Points right when shut, down when open — rotating a down-chevron
              would read as "up = open". */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            className={`w-3 h-3 shrink-0 text-[#8A979D] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
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
          {liveBar}
          {icon}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <ExternalArrow className="w-3 h-3 text-[#8A979D]" />
            </>
          )}
        </a>
      ) : linkTarget.plain ? (
        /* Our domain, not our router: a static file behind a rewrite. Same tab
           and no arrow — it is meant to read as another page of this app, not
           as a trip somewhere else. */
        <a href={linkTarget.href} className={rowClass} title={collapsed ? item.label : undefined}>
          {rowInner}
        </a>
      ) : (
        <Link href={linkTarget.href} className={rowClass} title={collapsed ? item.label : undefined}>
          {rowInner}
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
            <div className="flex flex-col gap-px pl-[30px] py-1">
              {item.children!.map((child) => {
                const childActive =
                  !child.external && (pathname === child.href || pathname.startsWith(child.href + "/"));
                const childBadge = child.href === "/customer-service/problems" && openProblems > 0;
                const childClass = `relative flex h-[30px] items-center gap-2 rounded-[6px] px-[10px] text-[12.5px] transition-colors ${
                  childActive
                    ? "bg-white font-semibold text-[#12171A] shadow-[0_1px_2px_rgba(18,23,26,.05)]"
                    : "font-medium text-[#5A686E] hover:bg-[rgba(18,23,26,.045)] hover:text-[#12171A]"
                }`;
                const childContent = (
                  <>
                    {childActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-[2px]"
                        style={{ background: tint }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{child.label}</span>
                    {childBadge ? (
                      // Plain text, not a pill — the parent's pill stays the
                      // loudest thing in the group.
                      <span className="text-[11px] font-bold text-[#B4462A] tabular-nums">
                        {openProblems}
                      </span>
                    ) : child.external ? (
                      <ExternalArrow className="w-3 h-3 text-[#8A979D]" />
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
                ) : child.plain ? (
                  <a
                    key={child.href}
                    href={child.href}
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
