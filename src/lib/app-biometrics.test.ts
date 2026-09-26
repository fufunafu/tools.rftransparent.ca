import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkBiometry, authenticate, remove } = vi.hoisted(() => ({
  checkBiometry: vi.fn(),
  authenticate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@aparajita/capacitor-biometric-auth", () => ({
  BiometricAuth: { checkBiometry, authenticate },
  BiometryType: { faceId: 2, touchId: 1 },
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
  getBiometricLabel,
  getBiometricPreference,
  setBiometricPreference,
  markNativeSessionFresh,
} from "@/lib/app-biometrics";

function nativeWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
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

afterEach(() => vi.useRealTimers());

describe("native session authentication", () => {
  it.each(["availability", "authentication"])("times out a stalled %s callback without accepting late success", async (stage) => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    const pending = new Promise((resolve) => { complete = resolve; });
    if (stage === "availability") checkBiometry.mockReturnValue(pending);
    else authenticate.mockReturnValue(pending);

    const result = authenticateAppSession();
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toEqual({ ok: false, reason: "timed_out" });
    complete({ isAvailable: true, deviceIsSecure: true });
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({ ok: false, reason: "timed_out" });
    if (stage === "availability") expect(authenticate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

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


describe("biometric setup preferences", () => {
  it("requires an explicit choice per account and normalizes account identity", () => {
    expect(getBiometricPreference("person@example.com")).toBe("unset");
    setBiometricPreference(" Person@Example.com ", "enabled");
    expect(getBiometricPreference("person@example.com")).toBe("enabled");
    expect(getBiometricPreference("another@example.com")).toBe("unset");
    setBiometricPreference("person@example.com", "disabled");
    expect(getBiometricPreference("person@example.com")).toBe("disabled");
  });

  it.each([[2, "Face ID"], [1, "Touch ID"]])("uses enrolled biometry type %s without requesting authentication", async (biometryType, label) => {
    checkBiometry.mockResolvedValue({ isAvailable: true, biometryType });
    await expect(getBiometricLabel()).resolves.toBe(label);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("does not offer Face ID merely because the device supports it", async () => {
    checkBiometry.mockResolvedValue({ isAvailable: false, biometryType: 2, deviceIsSecure: true });
    await expect(getBiometricLabel()).resolves.toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("does not block sign-in on a stalled capability check", async () => {
    vi.useFakeTimers();
    checkBiometry.mockReturnValue(new Promise(() => {}));
    const label = getBiometricLabel();
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(label).resolves.toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not infer consent from unavailable storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
    });
    expect(getBiometricPreference("person@example.com")).toBe("unset");
    expect(() => setBiometricPreference("person@example.com", "enabled")).toThrow();
  });
});
