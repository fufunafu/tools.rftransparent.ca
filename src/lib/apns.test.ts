import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deadTokens, groupRegisteredPushTokens } from "@/lib/apns";

describe("APNs token routing", () => {
  it("keeps sandbox and production device tokens on separate gateways", () => {
    expect(groupRegisteredPushTokens([
      { token: "debug-a", apns_environment: "sandbox" },
      { token: "release-a", apns_environment: "production" },
      { token: "debug-b", apns_environment: "sandbox" },
    ])).toEqual({
      sandbox: ["debug-a", "debug-b"],
      production: ["release-a"],
    });
  });

  it("disables only tokens Apple reports as invalid or unregistered", () => {
    expect(deadTokens([
      { token: "good", ok: true, status: 200 },
      { token: "gone", ok: false, status: 410, reason: "Unregistered" },
      { token: "bad", ok: false, status: 400, reason: "BadDeviceToken" },
      { token: "retry", ok: false, status: 0, reason: "network" },
    ])).toEqual(["gone", "bad"]);
  });
});
