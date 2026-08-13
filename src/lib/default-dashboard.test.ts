import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingleMock } = vi.hoisted(() => ({ maybeSingleMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        or: () => ({
          eq: () => ({
            limit: () => ({ maybeSingle: maybeSingleMock }),
          }),
        }),
      }),
    }),
  }),
}));

import { deriveDefaultDashboard, resolveLandingPage } from "@/lib/default-dashboard";
import { OWNER_EMAIL } from "@/lib/authz";

describe("deriveDefaultDashboard", () => {
  it("sends the owner to the owner dashboard regardless of anything else", () => {
    expect(
      deriveDefaultDashboard({ isOwner: true, department: "sales", locationName: "Toronto" })
    ).toBe("/");
  });

  it("sends management with a store location to that store's dashboard", () => {
    expect(
      deriveDefaultDashboard({ isOwner: false, department: "management", locationName: "Toronto" })
    ).toBe("/dashboards/store/toronto");
    expect(
      deriveDefaultDashboard({ isOwner: false, department: "Management", locationName: " montreal " })
    ).toBe("/dashboards/store/montreal");
  });

  it("sends management without a location (or an unmapped one) to the owner dashboard", () => {
    expect(
      deriveDefaultDashboard({ isOwner: false, department: "management", locationName: null })
    ).toBe("/");
    expect(
      deriveDefaultDashboard({ isOwner: false, department: "management", locationName: "Head Office" })
    ).toBe("/");
  });

  it("maps sales and marketing departments to their dashboards", () => {
    expect(deriveDefaultDashboard({ isOwner: false, department: "sales", locationName: null })).toBe(
      "/dashboards/sales"
    );
    expect(
      deriveDefaultDashboard({ isOwner: false, department: "marketing", locationName: "Toronto" })
    ).toBe("/dashboards/marketing");
  });

  it("defaults everyone else to the owner dashboard", () => {
    for (const department of ["warehouse", "customer_service", "unknown-dept", "", null]) {
      expect(deriveDefaultDashboard({ isOwner: false, department, locationName: null })).toBe("/");
    }
  });
});

describe("resolveLandingPage", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
  });

  it("returns an explicit preference without touching the database", async () => {
    const path = await resolveLandingPage({
      email: "rep@glass-railing.com",
      user_metadata: { rf_preferences: { homePage: "/todos" } },
    });
    expect(path).toBe("/todos");
    expect(maybeSingleMock).not.toHaveBeenCalled();
  });

  it("resolves auto via the employee's department", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { department: "sales", locations: null },
      error: null,
    });
    const path = await resolveLandingPage({ email: "rep@glass-railing.com", user_metadata: {} });
    expect(path).toBe("/dashboards/sales");
  });

  it("resolves a store manager to their store dashboard", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { department: "management", locations: { name: "Montreal" } },
      error: null,
    });
    const path = await resolveLandingPage({ email: "mgr@glass-railing.com", user_metadata: {} });
    expect(path).toBe("/dashboards/store/montreal");
  });

  it("falls back to the owner dashboard for the owner, missing rows, and query failures", async () => {
    expect(await resolveLandingPage({ email: OWNER_EMAIL, user_metadata: {} })).toBe("/");

    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect(await resolveLandingPage({ email: "ghost@glass-railing.com", user_metadata: {} })).toBe("/");

    maybeSingleMock.mockRejectedValue(new Error("db down"));
    expect(await resolveLandingPage({ email: "rep@glass-railing.com", user_metadata: {} })).toBe("/");

    expect(await resolveLandingPage({ email: null, user_metadata: {} })).toBe("/");
  });
});
