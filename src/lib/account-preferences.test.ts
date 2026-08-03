import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  getAccountPreferences,
  getCustomDisplayName,
  getPreferredName,
  sanitizeAccountPreferences,
} from "@/lib/account-preferences";

describe("account preferences", () => {
  it("uses defaults when metadata is missing", () => {
    expect(getAccountPreferences(null)).toEqual(DEFAULT_ACCOUNT_PREFERENCES);
  });

  it("accepts supported preference values", () => {
    expect(
      getAccountPreferences({
        rf_preferences: {
          homePage: "/sales",
          sidebarMode: "compact",
          canvasTone: "clean",
          motion: "reduced",
        },
      }),
    ).toEqual({
      homePage: "/sales",
      sidebarMode: "compact",
      canvasTone: "clean",
      motion: "reduced",
    });
  });

  it("rejects unsupported routes and option values", () => {
    expect(
      sanitizeAccountPreferences({
        homePage: "https://example.com",
        sidebarMode: "hidden",
        canvasTone: "neon",
        motion: "fast",
      }),
    ).toEqual(DEFAULT_ACCOUNT_PREFERENCES);
  });

  it("prefers a custom display name and trims it", () => {
    expect(
      getPreferredName({
        display_name: "  Anne Gao  ",
        full_name: "Fallback Name",
      }),
    ).toBe("Anne Gao");
  });

  it("distinguishes a custom name from provider metadata", () => {
    expect(getCustomDisplayName({ full_name: "Google Name" })).toBeNull();
    expect(getCustomDisplayName({ display_name: "  Preferred Name " })).toBe("Preferred Name");
  });
});
