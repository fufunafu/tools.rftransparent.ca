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
