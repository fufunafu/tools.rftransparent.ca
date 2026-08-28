import type { NavTarget } from "@/components/CommandPalette";

export type Status = "done" | "wip" | "todo";
export type AccessLevel = "authenticated" | "admin" | "management";
export type NavGroup = "overview" | "revenue" | "operations" | "finance";

// Rendered as labelled bands in the rail, in this order. NAV_ITEMS is kept in
// the same order, so rendering is a filter per group with no sort.
export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "revenue", label: "Revenue" },
  { id: "operations", label: "Operations" },
  { id: "finance", label: "Finance" },
];

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
  // Same meaning as on NavItem — this app's domain, but not this app's router.
  plain?: boolean;
  access?: AccessLevel;
}

export interface NavItem {
  href: string;
  label: string;
  status: Status;
  // A single <svg>. The row clones it to apply size, colour and stroke width,
  // so whatever classes are set here are replaced at render time.
  icon: React.ReactElement<React.SVGProps<SVGSVGElement>>;
  // Which labelled band this sits in. Optional on NavItem because the pinned
  // Settings item renders in the footer, outside every group — but required
  // on NavSection below, so a new entry in NAV_ITEMS can't skip it.
  group?: NavGroup;
  // When true, `href` is an absolute URL to a separate site — rendered as a
  // plain <a target="_blank"> instead of a Next.js <Link>.
  external?: boolean;
  // The section's own colour, worn by its icon and by the bar down the left of
  // the row when it is the live page. Without it every icon is the same grey
  // and the rail reads as one long undifferentiated list — the colour is what
  // makes a section recognisable before the label is read.
  tint?: string;
  // When true, `href` is on this domain but is not a route of this app — a
  // static file served through a rewrite. It gets a plain <a> in the same
  // tab: <Link> would try a client-side navigation, find no route payload and
  // fall back to a full load anyway, having already prefetched the whole file
  // on hover. Same tab, because the point of these is that they do not feel
  // like leaving.
  plain?: boolean;
  access?: AccessLevel;
  // Path prefixes that count as "inside" this section for highlighting and
  // auto-expanding. Defaults to `href`. Settings needs this because two of
  // its children (/employees, /health-check) predate the section and kept
  // their original URLs.
  match?: string[];
  children?: NavChild[];
}

/** A row in the main rail. Unlike NavItem, it must declare its group. */
export type NavSection = NavItem & { group: NavGroup };

export const NAV_ITEMS: NavSection[] = [
  {
    // The sidebar shows ONE dashboard entry; SidebarLayout swaps this href for
    // the viewer's own dashboard (picked via the on-page switcher, else their
    // role's default). `match` keeps it highlighted on every dashboard route.
    href: "/",
    label: "Dashboard",
    tint: "#4F8F7C",
    status: "done",
    group: "overview",
    match: ["/", "/dashboards"],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    href: "/todos",
    label: "Tasks",
    tint: "#3E6E96",
    status: "done",
    group: "overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    href: "/clock",
    label: "Clock",
    tint: "#5C5B9E",
    status: "done",
    group: "overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    href: "/sales",
    label: "Sales",
    tint: "#C79A12",
    status: "done",
    group: "revenue",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    tint: "#2FA39B",
    status: "done",
    group: "revenue",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
      </svg>
    ),
  },
  {
    href: "/marketing",
    label: "Marketing",
    tint: "#B4552C",
    status: "done",
    group: "revenue",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
    // The image library (six framed pages of the separate app under
    // src/app/library) lives here as children: it's marketing material, so it
    // sits under Marketing rather than as its own band.
    children: [
      { href: "/marketing", label: "Analytics", status: "done" },
      { href: "/library/photos", label: "Photo library", status: "done" },
      { href: "/library/shows", label: "Trade shows", status: "done" },
      { href: "/library/stores", label: "Stores", status: "done" },
      { href: "/library/workspace", label: "My workspace", status: "done" },
      // Both are gated inside the library as well, on its own permissions —
      // the flag here only decides who is shown the door. `admin` is a
      // deliberate under-offer: the vault opens at the library's `view` rung,
      // but most role templates carry passwords: "none", so a wider flag would
      // put a row in everyone's menu that bounces them with a toast. A door
      // that misfires for the majority is worse than no door. Anyone who needs
      // it today is an admin; canView("passwords") is what actually decides.
      { href: "/library/vault", label: "Accounts & Passwords", status: "done", access: "admin" },
      { href: "/library/team", label: "Team & access", status: "done", access: "admin" },
    ],
  },
  {
    href: "/warehouse",
    label: "Logistics",
    tint: "#5A6B73",
    status: "done",
    group: "operations",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
      </svg>
    ),
    children: [
      { href: "/warehouse", label: "Dashboard", status: "done", access: "management" },
      { href: "/warehouse/report", label: "Daily Report", status: "done" },
      { href: "/warehouse/shipping", label: "Shipping Quotes", status: "done" },
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
    tint: "#A83E3E",
    status: "done",
    group: "operations",
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
    tint: "#7A5EA8",
    status: "done",
    group: "finance",
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
    tint: "#2E7D4F",
    status: "done",
    group: "finance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
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
  tint: "#5A6B73",
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
    { href: "/settings/assistant", label: "Assistant Knowledge", status: "done", access: "admin" },
    { href: "/employees", label: "Employees", status: "done" },
    { href: "/settings/notifications", label: "Notifications", status: "done" },
    { href: "/settings/rates", label: "Rates & Thresholds", status: "done" },
    { href: "/settings/automations", label: "Automations", status: "done" },
    { href: "/health-check", label: "System Health", status: "done" },
    { href: "/settings/account", label: "My Account", status: "done" },
  ],
};

// True when `pathname` is the section itself or a page inside it. "/" is
// matched exactly — as a prefix it would swallow every route and light up
// Today on every page.
export function matchesItem(item: NavItem, pathname: string): boolean {
  return (item.match ?? [item.href]).some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

export function canAccess(required: AccessLevel | undefined, viewer: ViewerAccess): boolean {
  if (!required || required === "authenticated") return true;
  if (required === "admin") return viewer.isAdmin;
  return viewer.isManagement;
}

// Generic so a NavSection stays a NavSection — the caller still knows the
// group after filtering.
export function filterNavItem<T extends NavItem>(item: T, viewer: ViewerAccess): T | null {
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
