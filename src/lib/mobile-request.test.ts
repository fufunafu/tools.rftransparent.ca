import { describe, expect, it } from "vitest";
import { isMobileRequest } from "@/lib/mobile-request";

describe("isMobileRequest", () => {
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36",
  ])("recognizes a mobile request: %s", (userAgent) => {
    expect(isMobileRequest(userAgent)).toBe(true);
  });

  it("keeps desktop requests on the management dashboard", () => {
    expect(
      isMobileRequest(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      ),
    ).toBe(false);
    expect(isMobileRequest(null)).toBe(false);
  });
});
