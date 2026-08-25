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
  classifyNativeSessionResponse,
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
  it.each([401, 403])("treats HTTP %s as an expired server session", (status) => {
    expect(classifyNativeSessionResponse({ ok: false, status })).toBe("expired");
  });

  it("distinguishes a valid session from a temporary server failure", () => {
    expect(classifyNativeSessionResponse({ ok: true, status: 200 })).toBe("authenticated");
    expect(classifyNativeSessionResponse({ ok: false, status: 503 })).toBe("unavailable");
  });

  it("unlocks an existing session after successful device authentication", async () => {
    await expect(deviceUnlockAvailable()).resolves.toBe(true);
    await expect(authenticateAppSession()).resolves.toEqual({ ok: true });
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({
      allowDeviceCredential: true,
      reason: "Unlock RF Tools",
      iosFallbackTitle: "Use Passcode",
    }));
  });

  it.each(["appCancel", "systemCancel", "userCancel", "userFallback"])(
    "keeps the session locked for cancellation outcome %s",
    async (code) => {
      authenticate.mockRejectedValue({ code });
      await expect(authenticateAppSession()).resolves.toEqual({ ok: false, reason: "cancelled" });
    },
  );

  it.each(["biometryNotAvailable", "biometryNotEnrolled", "passcodeNotSet"])(
    "reports unavailable device authentication for %s",
    async (code) => {
      authenticate.mockRejectedValue({ code });
      await expect(authenticateAppSession()).resolves.toEqual({ ok: false, reason: "unavailable" });
    },
  );

  it("allows the device-passcode fallback when biometrics are not available", async () => {
    checkBiometry.mockResolvedValue({ isAvailable: false, deviceIsSecure: true });

    await expect(deviceUnlockAvailable()).resolves.toBe(true);
    await expect(authenticateAppSession()).resolves.toEqual({ ok: true });

    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({
      allowDeviceCredential: true,
      iosFallbackTitle: "Use Passcode",
    }));
  });

  it("reports an unclassified authentication failure without unlocking", async () => {
    authenticate.mockRejectedValue({ code: "authenticationFailed" });
    await expect(authenticateAppSession()).resolves.toEqual({ ok: false, reason: "failed" });
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
