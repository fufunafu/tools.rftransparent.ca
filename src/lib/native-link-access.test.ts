import { describe, expect, it } from "vitest";
import {
  canAccessNativeDestination,
  nativeLinkAccessRequirement,
  type NativeLinkViewer,
} from "@/lib/native-link-access";

const signedOut: NativeLinkViewer = {
  authenticated: false,
  department: null,
  management: false,
};

describe("native destination access", () => {
  it.each(["/privacy", "/support"])("keeps %s public", (pathname) => {
    expect(nativeLinkAccessRequirement(pathname)).toBe("public");
    expect(canAccessNativeDestination(pathname, signedOut)).toBe(true);
  });

  it("requires a valid session for personal destinations", () => {
    expect(canAccessNativeDestination("/clock", signedOut)).toBe(false);
    expect(canAccessNativeDestination("/clock", {
      ...signedOut,
      authenticated: true,
    })).toBe(true);
  });

  it("opens the personal warehouse report to warehouse staff and management", () => {
    expect(canAccessNativeDestination("/warehouse/report", {
      authenticated: true,
      department: "warehouse",
      management: false,
    })).toBe(true);
    expect(canAccessNativeDestination("/warehouse/report", {
      authenticated: true,
      department: "management",
      management: true,
    })).toBe(true);
    expect(canAccessNativeDestination("/warehouse/report", {
      authenticated: true,
      department: "sales",
      management: false,
    })).toBe(false);
  });

  it("preserves frontline and management routing for role home pages", () => {
    expect(canAccessNativeDestination("/sales", {
      authenticated: true,
      department: "sales",
      management: false,
    })).toBe(true);
    expect(canAccessNativeDestination("/customer-service", {
      authenticated: true,
      department: "customer_service",
      management: false,
    })).toBe(true);
    expect(canAccessNativeDestination("/sales", {
      authenticated: true,
      department: null,
      management: true,
    })).toBe(true);
  });

  it("keeps the personal customer-service queue role-restricted", () => {
    expect(nativeLinkAccessRequirement("/customer-service")).toBe("customer-service-or-management");
    expect(canAccessNativeDestination("/customer-service", {
      authenticated: true,
      department: "customer_service",
      management: false,
    })).toBe(true);
    expect(canAccessNativeDestination("/customer-service", {
      authenticated: true,
      department: "sales",
      management: false,
    })).toBe(false);
  });

  it.each([
    "/customer-service/follow-up",
    "/customer-service/problems",
    "/dashboards/marketing",
    "/employees",
  ])("keeps shared destination %s available to authenticated roles", (pathname) => {
    expect(nativeLinkAccessRequirement(pathname)).toBe("authenticated");
    expect(canAccessNativeDestination(pathname, {
      authenticated: true,
      department: "sales",
      management: false,
    })).toBe(true);
  });

  it("keeps the warehouse management destination restricted", () => {
    expect(nativeLinkAccessRequirement("/warehouse")).toBe("management");
    expect(canAccessNativeDestination("/warehouse", {
      authenticated: true,
      department: "warehouse",
      management: false,
    })).toBe(false);
    expect(canAccessNativeDestination("/warehouse", {
      authenticated: true,
      department: "management",
      management: true,
    })).toBe(true);
  });
});
