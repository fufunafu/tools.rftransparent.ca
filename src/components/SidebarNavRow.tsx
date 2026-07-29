"use client";

import Link from "next/link";
import { matchesItem, type NavItem } from "@/components/nav-items";

const ExternalArrow = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);

const StatusDot = ({ status, small }: { status: string; small?: boolean }) => {
  const size = "w-1.5 h-1.5";
  if (status === "done") {
    return <span className={`${size} rounded-full bg-emerald-400 ring-2 ring-emerald-50`} title="Ready" />;
  }
  if (status === "wip") {
    return <span className={`${size} rounded-full bg-amber-400 ring-2 ring-amber-50`} title="In progress" />;
  }
  if (small) return null;
  return <span className={`${size} rounded-full bg-slate-300 ring-2 ring-slate-100`} title="Not started" />;
};

/**
 * One sidebar section: the parent row plus its children when expanded.
 * Used for both the scrolling nav list and the pinned Settings group.
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
  const active = matchesItem(item, pathname);
  const hasChildren = Boolean(item.children?.length);
  const sectionId = `sidebar-section-${item.href.replace(/[^a-z0-9]+/gi, "-")}`;

  const rowClass = `group flex min-h-10 items-center gap-2.5 rounded-xl border px-2.5 text-sm font-medium transition-all ${
    active
      ? "border-blue-100 bg-white text-blue-700 shadow-sm shadow-slate-200/60"
      : "border-transparent text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm hover:shadow-slate-200/50"
  }`;
  const iconClass = `flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
    active
      ? "bg-blue-50 text-blue-600"
      : "text-slate-400 group-hover:bg-slate-50 group-hover:text-slate-600"
  }`;

  // Open problem tickets live under Customer Service — the count badge sits
  // on that parent so it stays visible on every page.
  const showBadge = item.href === "/customer-service" && openProblems > 0;
  const badge = showBadge ? (
    <span
      className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center"
      title={`${openProblems} open problem ticket${openProblems === 1 ? "" : "s"}`}
    >
      {openProblems}
    </span>
  ) : null;

  const trailing = collapsed ? null : (badge ?? <StatusDot status={item.status} />);

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
          <span className={iconClass}>{item.icon}</span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {trailing}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
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
          <span className={iconClass}>{item.icon}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <ExternalArrow className="w-3.5 h-3.5 text-slate-300" />
            </>
          )}
        </a>
      ) : (
        <Link
          href={hasChildren ? item.children![0].href : item.href}
          className={rowClass}
          title={collapsed ? item.label : undefined}
        >
          <span className={`${iconClass} relative`}>
            {item.icon}
            {/* Collapsed sidebar has no room for the count pill — a corner dot
                still signals open problem tickets. */}
            {collapsed && showBadge && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-slate-50" />
            )}
          </span>
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
            <div className="relative ml-[22px] mt-1.5 mb-1 space-y-0.5 border-l border-slate-200 pl-[21px]">
              {item.children!.map((child) => {
                const childActive =
                  !child.external && (pathname === child.href || pathname.startsWith(child.href + "/"));
                const childBadge = child.href === "/customer-service/problems" && openProblems > 0;
                const childClass = `flex min-h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
                  childActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-500 hover:bg-white hover:text-slate-800"
                }`;
                const childContent = (
                  <>
                    <span className="min-w-0 flex-1 truncate">{child.label}</span>
                    {childBadge ? (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                        {openProblems}
                      </span>
                    ) : child.external ? (
                      <ExternalArrow className="w-3 h-3 text-slate-300" />
                    ) : (
                      <StatusDot status={child.status} small />
                    )}
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
