import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  SETTINGS_ITEM,
  filterNavItem,
  getSearchTargets,
  activeChildHref,
  matchesItem,
  type NavItem,
  type ViewerAccess,
} from "@/components/nav-items";
import { LIBRARY_PAGES, librarySrc } from "@/lib/library-pages";

function visibleItems(viewer: ViewerAccess): NavItem[] {
  return [...NAV_ITEMS, SETTINGS_ITEM]
    .map((item) => filterNavItem(item, viewer))
    .filter((item): item is NavItem => item !== null);
}

describe("role-aware navigation", () => {
  it("hides management and admin destinations from regular employees", () => {
    const targets = getSearchTargets(visibleItems({ isAdmin: false, isManagement: false }));
    const hrefs = targets.map((target) => target.href);

    expect(hrefs).not.toContain("/warehouse/purchasing");
    expect(hrefs).not.toContain("/settings/access");
    expect(hrefs).toContain("/settings/account");
  });

  it("shows purchasing to management without exposing admin access settings", () => {
    const targets = getSearchTargets(visibleItems({ isAdmin: false, isManagement: true }));
    const hrefs = targets.map((target) => target.href);

    expect(hrefs).toContain("/warehouse/purchasing");
    expect(hrefs).not.toContain("/settings/access");
  });

  it("keeps the vault out of a non-admin's menu and offers it to an admin", () => {
    const employee = getSearchTargets(visibleItems({ isAdmin: false, isManagement: false }))
      .map((target) => target.href);
    const admin = getSearchTargets(visibleItems({ isAdmin: true, isManagement: false }))
      .map((target) => target.href);

    // The library refuses anyone without canView("passwords") at the door, so
    // the menu deliberately under-offers rather than showing a row that
    // bounces most of the company with a toast.
    expect(employee).not.toContain("/library/vault");
    expect(admin).toContain("/library/vault");
  });

  it("shows access settings to admins without implying management authority", () => {
    const targets = getSearchTargets(visibleItems({ isAdmin: true, isManagement: false }));
    const hrefs = targets.map((target) => target.href);

    expect(hrefs).toContain("/settings/access");
    expect(hrefs).not.toContain("/warehouse/purchasing");
  });
});

describe("section highlighting", () => {
  const section = (label: string) => NAV_ITEMS.find((item) => item.label === label)!;

  it("lights up Work in progress, not the prefix section, for unfinished tools", () => {
    for (const path of ["/customer-service/tmp", "/warehouse/purchasing", "/customer-service/outreach/leads"]) {
      expect(matchesItem(section("Work in progress"), path)).toBe(true);
    }
    expect(matchesItem(section("Customer Service"), "/customer-service/tmp")).toBe(false);
    expect(matchesItem(section("Logistics"), "/warehouse/purchasing")).toBe(false);
  });

  it("keeps finished pages in their home section", () => {
    expect(matchesItem(section("Customer Service"), "/customer-service/leads/rf")).toBe(true);
    expect(matchesItem(section("Logistics"), "/warehouse/report")).toBe(true);
    expect(matchesItem(section("Work in progress"), "/customer-service/leads")).toBe(false);
  });

  it("still highlights Dashboard after its href is swapped for the viewer's own", () => {
    const dashboard = { ...section("Dashboard"), href: "/dashboards/sales" };
    expect(matchesItem(dashboard, "/dashboards/sales")).toBe(true);
  });

  it("lights up only the most specific child row", () => {
    expect(activeChildHref("/warehouse/purchasing/inventory")).toBe("/warehouse/purchasing");
    expect(activeChildHref("/warehouse/report")).toBe("/warehouse/report");
    expect(activeChildHref("/warehouse")).toBe("/warehouse");
    expect(activeChildHref("/customer-service/leads/rf")).toBe("/customer-service/leads");
  });
});

describe("the framed image library", () => {
  const libraryRows = NAV_ITEMS
    .flatMap((item) => item.children ?? [])
    .filter((child) => child.href.startsWith("/library/"));

  // The failure this is here to catch: the rail offering a page the frame
  // cannot open. It happened. Two of the six rows pushed in the spring landed
  // on the photo library because the library had renamed the page and nothing
  // connected the two lists.
  it("only links to pages the frame knows how to open", () => {
    expect(libraryRows.length).toBeGreaterThan(10);
    for (const row of libraryRows) {
      const slug = row.href.slice("/library/".length);
      expect(Object.keys(LIBRARY_PAGES), `${row.label} (${row.href})`).toContain(slug);
    }
  });

  // The library's pages are under /library, the section is /marketing. Before
  // the section claimed that prefix, arriving on a library page closed the
  // dropdown you had just used and left nothing on the rail lit.
  it("counts a library page as being inside Marketing", () => {
    const marketing = NAV_ITEMS.find((item) => item.label === "Marketing")!;
    for (const path of ["/library/photos", "/library/ads-meta", "/library/vault", "/marketing"]) {
      expect(matchesItem(marketing, path), path).toBe(true);
    }
    // And no one else claims it.
    for (const item of NAV_ITEMS) {
      if (item.label === "Marketing") continue;
      expect(matchesItem(item, "/library/photos"), item.label).toBe(false);
    }
    expect(activeChildHref("/library/ads-report")).toBe("/library/ads-report");
  });

  it("sends the library its own slug, with our chrome switched off", () => {
    expect(librarySrc("shows")).toBe("/library.html?chrome=off#/trade-shows");
    expect(librarySrc("vault")).toBe("/library.html?chrome=off#/passwords");
    // The photo library is the file's plain address, and an unknown tail
    // lands there rather than on a blank page.
    expect(librarySrc("photos")).toBe("/library.html?chrome=off");
    expect(librarySrc("nonsense")).toBe("/library.html?chrome=off");
  });

  it("captions the clusters without turning one into a destination", () => {
    const marketing = NAV_ITEMS.find((item) => item.label === "Marketing")!;
    const captions = marketing.children!.filter((child) => child.cap);
    expect(captions.length).toBeGreaterThanOrEqual(4);
    // A caption is a label on the row it rides, not a row of its own: every
    // one of them still has somewhere to go.
    for (const child of captions) expect(child.href).toMatch(/^\//);

    const targets = getSearchTargets([marketing]);
    expect(targets).toHaveLength(marketing.children!.length);
    expect(targets.map((target) => target.label)).not.toContain("Library");
  });

  it("keeps the private cluster's heading with the rows it belongs to", () => {
    const forEmployee = filterNavItem(
      NAV_ITEMS.find((item) => item.label === "Marketing")!,
      { isAdmin: false, isManagement: false },
    )!;
    const labels = forEmployee.children!.map((child) => child.label);
    expect(labels).not.toContain("Accounts & Passwords");
    // The caption rides on the first row of its cluster, so it leaves with it.
    expect(forEmployee.children!.some((child) => child.cap === "Private")).toBe(false);
    expect(forEmployee.children!.some((child) => child.cap === "Library")).toBe(true);
  });
});
