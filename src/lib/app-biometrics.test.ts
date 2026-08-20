import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkBiometry, authenticate, remove } = vi.hoisted(() => ({
  checkBiometry: vi.fn(),
  authenticate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@aparajita/capacitor-biometric-auth", () => ({
  BiometricAuth: { checkBiometry, authenticate },
}));
vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: { remove },
}));

import {
  authenticateAppSession,
  clearLegacySavedCredentials,
  consumeFreshNativeSession,
  deviceUnlockAvailable,
  markNativeSessionFresh,
} from "@/lib/app-biometrics";

function nativeWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  nativeWindow();
  checkBiometry.mockResolvedValue({ isAvailable: true, deviceIsSecure: true });
  authenticate.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

describe("native session authentication", () => {
  it("unlocks an existing session after successful device authentication", async () => {
    await expect(deviceUnlockAvailable()).resolves.toBe(true);
    await expect(authenticateAppSession()).resolves.toEqual({ ok: true });
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({
      allowDeviceCredential: true,
      reason: "Unlock RF Tools",
    }));
  });

  it("keeps the session locked when the person cancels Face ID", async () => {
    authenticate.mockRejectedValue({ code: "userCancel" });
    await expect(authenticateAppSession()).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("reports when the device has no authentication configured", async () => {
    checkBiometry.mockResolvedValue({ isAvailable: false, deviceIsSecure: false });
    await expect(deviceUnlockAvailable()).resolves.toBe(false);
    await expect(authenticateAppSession()).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("reports device lockout separately", async () => {
    authenticate.mockRejectedValue({ code: "biometryLockout" });
    await expect(authenticateAppSession()).resolves.toEqual({ ok: false, reason: "locked" });
  });

  it("consumes the one-time fresh-session marker", () => {
    markNativeSessionFresh();
    expect(consumeFreshNativeSession()).toBe(true);
    expect(consumeFreshNativeSession()).toBe(false);
  });

  it("deletes the credential key written by older releases", async () => {
    await clearLegacySavedCredentials();
    expect(remove).toHaveBeenCalledWith("rf-login-credentials");
  });
});
