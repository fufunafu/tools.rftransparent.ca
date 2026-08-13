// Face ID / Touch ID sign-in, available only when the site runs inside the
// RF Tools iOS app (Capacitor injects `window.Capacitor` into the page).
// In a normal browser every function quietly reports "not available" — the
// plugin code is dynamically imported so it never lands in the web bundle.
//
// The model: after a successful email+password sign-in inside the app, the
// credentials go into the device Keychain (hardware-encrypted, per-device).
// Next time, the login page offers Face ID; passing the check releases the
// stored credentials and signs in with them.

const CREDENTIALS_KEY = "rf-login-credentials";

export interface SavedCredentials {
  email: string;
  password: string;
}

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform?: () => boolean };
}

export function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as CapacitorGlobal).Capacitor?.isNativePlatform?.())
  );
}

export async function biometryAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
}

export async function savedCredentialsExist(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    return (await SecureStorage.get(CREDENTIALS_KEY)) !== null;
  } catch {
    return false;
  }
}

export async function saveCredentials(email: string, password: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.set(CREDENTIALS_KEY, { email, password });
  } catch {
    // Failing to save is not fatal — the user just signs in manually next time.
  }
}

export async function clearSavedCredentials(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.remove(CREDENTIALS_KEY);
  } catch {
    // Nothing sensible to do; the key may simply not exist.
  }
}

// Prompts Face ID / Touch ID and, if it passes, returns the stored
// credentials. Returns null when the user cancels, the check fails, or
// nothing is stored.
export async function unlockWithBiometrics(): Promise<SavedCredentials | null> {
  if (!isNativeApp()) return null;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason: "Sign in to RF Tools",
      cancelTitle: "Use password instead",
    });
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    const data = (await SecureStorage.get(CREDENTIALS_KEY)) as SavedCredentials | null;
    return data && typeof data.email === "string" && typeof data.password === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}
