import { describe, expect, it } from "vitest";
import { normalizePushDeviceToken } from "@/lib/push-device-token";

describe("push device token validation", () => {
  it("accepts APNs and FCM token forms without changing their case", () => {
    const apns = "A1".repeat(32);
    const fcm = `${"a".repeat(40)}:APA91b-token_value`;
    expect(normalizePushDeviceToken(apns)).toBe(apns);
    expect(normalizePushDeviceToken(fcm)).toBe(fcm);
  });

  it.each([
    null,
    123,
    "short",
    "a".repeat(201),
    `${"a".repeat(31)}?`,
    `${"a".repeat(31)}\n`,
  ])("rejects malformed token value %s", (value) => {
    expect(normalizePushDeviceToken(value)).toBeNull();
  });
});
