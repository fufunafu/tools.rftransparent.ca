import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  info: vi.fn(),
  location: vi.fn(),
  permissions: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({
  getDeviceInfo: mocks.info,
  getLocationAuthorizationStatus: mocks.location,
}) }));
vi.mock("@/lib/app-biometrics", () => ({ isNativeApp: mocks.native, deviceUnlockAvailable: async () => true }));
vi.mock("@/lib/native-diagnostics", () => ({ recordNativeDiagnosticEvent: vi.fn() }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: { checkPermissions: mocks.permissions } }));

import { getNativePermissionSnapshot } from "./native-support";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockReturnValue(true);
  mocks.location.mockResolvedValue({ status: "prompt-with-rationale" });
  mocks.permissions.mockResolvedValue({ receive: "granted" });
});

describe("native push capability", () => {
  it("reports unavailable without asking the OS when the binary has no push provider", async () => {
    mocks.info.mockResolvedValue({ operatingSystem: "Android 16", pushEnvironment: null });
    expect(await getNativePermissionSnapshot()).toEqual({
      notifications: "unavailable", location: "prompt", deviceAuthentication: "granted",
    });
    expect(mocks.permissions).not.toHaveBeenCalled();
  });

  it("preserves permission reporting for configured iOS binaries", async () => {
    mocks.info.mockResolvedValue({ operatingSystem: "iOS", pushEnvironment: "production" });
    expect((await getNativePermissionSnapshot()).notifications).toBe("granted");
    expect(mocks.permissions).toHaveBeenCalledOnce();
  });
});
