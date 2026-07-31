import type { NavTarget } from "@/components/CommandPalette";

export type Status = "done" | "wip" | "todo";
export type AccessLevel = "authenticated" | "admin" | "management";

export interface ViewerAccess {
  isAdmin: boolean;
  isManagement: boolean;
}

export interface NavChild {
  href: string;
  label: string;
  status: Status;
  // Same meaning as on NavItem — an absolute URL to a separate site.
  external?: boolean;
  access?: AccessLevel;
}

export interface NavItem {
  href: string;
  label: string;
  status: Status;
  icon: React.ReactNode;
  // When true, `href` is an absolute URL to a separate site — rendered as a
  // plain <a target="_blank"> instead of a Next.js <Link>.
  external?: boolean;
  access?: AccessLevel;
  // Path prefixes that count as "inside" this section for highlighting and
  // auto-expanding. Defaults to `href`. Settings needs this because two of
  // its children (/employees, /health-check) predate the section and kept
  // their original URLs.
  match?: string[];
  children?: NavChild[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/sales",
    label: "Sales",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
      </svg>
    ),
  },
  {
    href: "/marketing",
    label: "Marketing",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    href: "/warehouse",
    label: "Logistics",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
      </svg>
    ),
    children: [
      { href: "/warehouse", label: "Dashboard", status: "done" },
      { href: "/warehouse/report", label: "Daily Report", status: "done" },
      { href: "/warehouse/purchasing", label: "Purchasing", status: "wip", access: "management" },
      {
        href: "https://orderstream-checker.vercel.app/",
        label: "Order Stream",
        status: "done",
        external: true,
      },
      {
        href: "https://orderstream-checker.vercel.app/customs",
        label: "Customs Invoice",
        status: "done",
        external: true,
      },
    ],
  },
  {
    href: "/customer-service",
    label: "Customer Service",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
      </svg>
    ),
    children: [
      { href: "/customer-service/phones", label: "Phones", status: "done" },
      { href: "/customer-service/emails", label: "Emails", status: "done" },
      { href: "/customer-service/follow-up", label: "Follow-up", status: "done" },
      { href: "/customer-service/leads", label: "Leads", status: "wip" },
      { href: "/customer-service/problems", label: "Problem Tickets", status: "done" },
    ],
  },
  {
    href: "/accounting",
    label: "Accounting",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V18Zm2.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0 0 12 2.25Z" />
      </svg>
    ),
    children: [
      { href: "/accounting/analysis", label: "Analysis", status: "done" },
      { href: "/accounting/reimbursement", label: "Reimbursement", status: "done" },
      {
        href: "https://invoicebox-delta.vercel.app/",
        label: "InvoiceBox",
        status: "done",
        external: true,
      },
    ],
  },
  {
    href: "/shopify",
    label: "Shopify",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
      </svg>
    ),
  },
  {
    href: "/todos",
    label: "Tasks",
    status: "done",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
];

// Pinned to the bottom of the sidebar, above Sign out. Employees and System
// Health keep their original URLs — `match` is what makes the section
// highlight and stay open while you're on them.
export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Settings",
  status: "done",
  match: ["/settings", "/employees", "/health-check"],
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
  children: [
    { href: "/settings/access", label: "Who Can Sign In", status: "done", access: "admin" },
    { href: "/employees", label: "Employees", status: "done" },
    { href: "/settings/notifications", label: "Notifications", status: "done" },
    { href: "/settings/rates", label: "Rates & Thresholds", status: "done" },
    { href: "/settings/automations", label: "Automations", status: "done" },
    { href: "/health-check", label: "System Health", status: "done" },
    { href: "/settings/account", label: "My Account", status: "done" },
  ],
};

// True when `pathname` is the section itself or a page inside it.
export function matchesItem(item: NavItem, pathname: string): boolean {
  return (item.match ?? [item.href]).some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

export function canAccess(required: AccessLevel | undefined, viewer: ViewerAccess): boolean {
  if (!required || required === "authenticated") return true;
  if (required === "admin") return viewer.isAdmin;
  return viewer.isManagement;
}

export function filterNavItem(item: NavItem, viewer: ViewerAccess): NavItem | null {
  if (!canAccess(item.access, viewer)) return null;
  if (!item.children) return item;

  const children = item.children.filter((child) => canAccess(child.access, viewer));
  if (children.length === 0) return null;
  return { ...item, children };
}

// Flat list of destinations the current viewer can jump to. Sections with
// children contribute their children rather than themselves.
export function getSearchTargets(items: NavItem[]): NavTarget[] {
  return items.flatMap((item) =>
  item.children
    ? item.children.map((child) => ({
        href: child.href,
        label: child.label,
        section: item.label,
        external: child.external,
      }))
    : [{ href: item.href, label: item.label, external: item.external }]
  );
}
