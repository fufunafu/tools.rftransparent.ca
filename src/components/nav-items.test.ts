import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  SETTINGS_ITEM,
  filterNavItem,
  getSearchTargets,
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

  it("offers Manage library to a signed-in viewer who is not an admin", () => {
    const employee = getSearchTargets(visibleItems({ isAdmin: false, isManagement: false }))
      .map((target) => target.href);

    // Managing the library is ordinary work, so the row is not held back the
    // way an admin destination is. canEdit("library") refuses inside the
    // library for an account that only browses.
    expect(employee).toContain("/library/manage");
    expect(employee).not.toContain("/settings/access");
  });

  it("shows access settings to admins without implying management authority", () => {
    const targets = getSearchTargets(visibleItems({ isAdmin: true, isManagement: false }));
    const hrefs = targets.map((target) => target.href);

    expect(hrefs).toContain("/settings/access");
    expect(hrefs).not.toContain("/warehouse/purchasing");
  });
});
