// Native session locking for the RF Tools iOS app. Supabase owns the actual
// authenticated session in WebView cookies. Biometrics only unlock the UI and
// never release or store an account password.

const LEGACY_CREDENTIALS_KEY = "rf-login-credentials";
const FRESH_SESSION_KEY = "rf-native-session-fresh";

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform?: () => boolean };
}

export type DeviceUnlockResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "unavailable" | "locked" | "failed" };

export function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as CapacitorGlobal).Capacitor?.isNativePlatform?.())
  );
}

export function markNativeSessionFresh(): void {
  if (!isNativeApp()) return;
  sessionStorage.setItem(FRESH_SESSION_KEY, "1");
}

export function consumeFreshNativeSession(): boolean {
  if (!isNativeApp()) return false;
  const fresh = sessionStorage.getItem(FRESH_SESSION_KEY) === "1";
  sessionStorage.removeItem(FRESH_SESSION_KEY);
  return fresh;
}

export async function deviceUnlockAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable || result.deviceIsSecure;
  } catch {
    return false;
  }
}

export async function authenticateAppSession(): Promise<DeviceUnlockResult> {
  if (!isNativeApp()) return { ok: false, reason: "unavailable" };
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const available = await BiometricAuth.checkBiometry();
    if (!available.isAvailable && !available.deviceIsSecure) {
      return { ok: false, reason: "unavailable" };
    }
    await BiometricAuth.authenticate({
      reason: "Unlock RF Tools",
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use Passcode",
    });
    return { ok: true };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (["appCancel", "systemCancel", "userCancel", "userFallback"].includes(code)) {
      return { ok: false, reason: "cancelled" };
    }
    if (code === "biometryLockout") return { ok: false, reason: "locked" };
    if (["biometryNotAvailable", "biometryNotEnrolled", "passcodeNotSet"].includes(code)) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: false, reason: "failed" };
  }
}

// Remove credentials written by older app builds. Keep this migration for at
// least one widely deployed release, then the secure-storage dependency can be
// removed entirely.
export async function clearLegacySavedCredentials(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.remove(LEGACY_CREDENTIALS_KEY);
  } catch {
    // The key usually does not exist on new installations.
  }
}
