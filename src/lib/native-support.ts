import { registerPlugin } from "@capacitor/core";
import { deviceUnlockAvailable, isNativeApp } from "@/lib/app-biometrics";
import { recordNativeDiagnosticEvent } from "@/lib/native-diagnostics";

interface RFNativeSupportPlugin {
  getDeviceInfo(): Promise<NativeDeviceInfo>;
  getLocationAuthorizationStatus(): Promise<{ status: NativePermissionState }>;
  hidePrivacyShield(): Promise<void>;
  recordWebViewLoadFailure(): Promise<void>;
  retryRemoteLoad(): Promise<void>;
  openSettings(): Promise<void>;
}

const RFNativeSupport = registerPlugin<RFNativeSupportPlugin>("RFNativeSupport");

export interface NativeDeviceInfo {
  operatingSystem: string;
  deviceModel: string;
  locale: string;
  pushEnvironment: "sandbox" | "production";
  nativeCrashCount: number;
  lastNativeCrashAt: string | null;
  lastNativeCrashSignature: string | null;
  webViewLoadFailureCount: number;
  lastWebViewLoadFailureAt: string | null;
  lastLifecycleError: string | null;
}

export type NativePermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "restricted"
  | "unavailable";

export interface NativePermissionSnapshot {
  notifications: NativePermissionState;
  location: NativePermissionState;
  deviceAuthentication: NativePermissionState;
}

function normalizePermission(value: string): NativePermissionState {
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  if (value === "prompt" || value === "prompt-with-rationale") return "prompt";
  if (value === "restricted" || value === "limited") return "restricted";
  return "unavailable";
}

export async function getNativeDeviceInfo(): Promise<NativeDeviceInfo | null> {
  if (!isNativeApp()) return null;
  try {
    return await RFNativeSupport.getDeviceInfo();
  } catch {
    recordNativeDiagnosticEvent("plugin_failed");
    return null;
  }
}

export async function openNativeSettings(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    await RFNativeSupport.openSettings();
    return true;
  } catch {
    recordNativeDiagnosticEvent("plugin_failed");
    return false;
  }
}

export async function getNativeLocationAuthorizationStatus(): Promise<NativePermissionState> {
  if (!isNativeApp()) return "unavailable";
  try {
    const result = await RFNativeSupport.getLocationAuthorizationStatus();
    return normalizePermission(result.status);
  } catch {
    recordNativeDiagnosticEvent("plugin_failed");
    return "unavailable";
  }
}

export async function hideNativePrivacyShield(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    await RFNativeSupport.hidePrivacyShield();
    return true;
  } catch {
    recordNativeDiagnosticEvent("plugin_failed");
    return false;
  }
}

export async function getNativePermissionSnapshot(): Promise<NativePermissionSnapshot> {
  const unavailable: NativePermissionSnapshot = {
    notifications: "unavailable",
    location: "unavailable",
    deviceAuthentication: "unavailable",
  };
  if (!isNativeApp()) return unavailable;

  const [notifications, location, authentication] = await Promise.allSettled([
    import("@capacitor/push-notifications").then(({ PushNotifications }) =>
      PushNotifications.checkPermissions(),
    ),
    getNativeLocationAuthorizationStatus(),
    deviceUnlockAvailable(),
  ]);

  return {
    notifications:
      notifications.status === "fulfilled"
        ? normalizePermission(notifications.value.receive)
        : "unavailable",
    location:
      location.status === "fulfilled"
        ? location.value
        : "unavailable",
    deviceAuthentication:
      authentication.status === "fulfilled" && authentication.value
        ? "granted"
        : "unavailable",
  };
}
