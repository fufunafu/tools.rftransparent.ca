"use client";

import Link from "next/link";
import { matchesItem, type NavItem } from "@/components/nav-items";

const ExternalArrow = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);

const StatusDot = ({ status, small }: { status: string; small?: boolean }) => {
  const size = small ? "w-1.5 h-1.5" : "w-2 h-2";
  if (status === "done") return <span className={`${size} rounded-full bg-green-500`} title="Ready" />;
  if (status === "wip") return <span className={`${size} rounded-full bg-amber-400`} title="In progress" />;
  if (small) return null;
  return <span className={`${size} rounded-full bg-slate-300`} title="Not started" />;
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

  const rowClass = `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    active ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={`${rowClass} w-full text-left`}>
          <span className={`shrink-0 ${active ? "text-blue-500" : "text-slate-400"}`}>{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {trailing}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
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
          <span className="shrink-0 text-slate-400">{item.icon}</span>
          {!collapsed && (
            <>
              <span className="flex-1">{item.label}</span>
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
          <span className={`relative shrink-0 ${active ? "text-blue-500" : "text-slate-400"}`}>
            {item.icon}
            {/* Collapsed sidebar has no room for the count pill — a corner dot
                still signals open problem tickets. */}
            {collapsed && showBadge && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1">{item.label}</span>
              {trailing}
            </>
          )}
        </Link>
      )}

      {hasChildren && !collapsed && (
        <div className={`overflow-hidden transition-all duration-200 ${expanded ? "max-h-72" : "max-h-0"}`}>
          {item.children!.map((child) => {
            const childActive =
              !child.external && (pathname === child.href || pathname.startsWith(child.href + "/"));
            const childBadge = child.href === "/customer-service/problems" && openProblems > 0;
            const childClass = `flex items-center gap-3 pl-11 pr-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
              childActive ? "text-blue-600" : "text-slate-400 hover:text-slate-700"
            }`;
            const childContent = (
              <>
                <span className="flex-1">{child.label}</span>
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
              >
                {childContent}
              </a>
            ) : (
              <Link key={child.href} href={child.href} className={childClass}>
                {childContent}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
