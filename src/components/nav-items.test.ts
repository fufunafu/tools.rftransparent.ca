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

  it("shows access settings to admins without implying management authority", () => {
    const targets = getSearchTargets(visibleItems({ isAdmin: true, isManagement: false }));
    const hrefs = targets.map((target) => target.href);

    expect(hrefs).toContain("/settings/access");
    expect(hrefs).not.toContain("/warehouse/purchasing");
  });
});
