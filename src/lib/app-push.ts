// Push-notification registration for the iOS app. Browser and home-screen
// installs never load the plugin (dynamic import), and every function is a
// quiet no-op outside the native shell.

import { isNativeApp } from "@/lib/app-biometrics";
import { resolveAuthorizedNativeLink } from "@/lib/native-links";
import { recordNativeDiagnosticEvent } from "@/lib/native-diagnostics";
import { getNativeDeviceInfo } from "@/lib/native-support";

// The device token APNs last handed us, kept so sign-out can tell the server
// to stop notifying this phone.
const TOKEN_KEY = "rf-push-token";

const SIGNED_OUT_PATHS = [
  "/login",
  "/privacy",
  "/support",
  "/survey",
  "/wall",
  "/forgot-password",
  "/reset-password",
];

export function shouldRegisterPushForPath(pathname: string): boolean {
  return !SIGNED_OUT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export interface PushPreferences {
  task_updates: boolean;
  overdue_updates: boolean;
  clock_reminders: boolean;
  followup_updates: boolean;
  callback_updates: boolean;
}

export type PushRegistrationStatus =
  | "registered"
  | "denied"
  | "unavailable"
  | "failed";

let registrationInFlight: Promise<PushRegistrationStatus> | null = null;
let registrationEpoch = 0;

async function disablePushToken(token: string): Promise<boolean> {
  const response = await fetch(`/api/push/register?token=${encodeURIComponent(token)}`, {
    method: "DELETE",
    keepalive: true,
  });
  return response.ok;
}

export function getStoredPushToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export async function getPushPreferences(): Promise<PushPreferences | null> {
  const token = getStoredPushToken();
  if (!token) return null;
  const response = await fetch(`/api/push/preferences?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Notification preferences are unavailable.");
  return response.json();
}

export async function updatePushPreferences(
  updates: Partial<PushPreferences>,
): Promise<PushPreferences> {
  const token = getStoredPushToken();
  if (!token) throw new Error("Enable notifications on this device first.");
  const response = await fetch("/api/push/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...updates }),
  });
  if (!response.ok) throw new Error("Notification preferences could not be saved.");
  return response.json();
}
async function performPushRegistration(): Promise<PushRegistrationStatus> {
  if (!isNativeApp()) return "unavailable";
  const epoch = registrationEpoch;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const device = await getNativeDeviceInfo();
    if (!device?.pushEnvironment) {
      recordNativeDiagnosticEvent("push_registration_failed");
      return "unavailable";
    }

    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") return "denied";

    await PushNotifications.removeAllListeners();
    let settleRegistration: (status: PushRegistrationStatus) => void = () => {};
    const registrationResult = new Promise<PushRegistrationStatus>((resolve) => {
      settleRegistration = resolve;
    });
    await PushNotifications.addListener("registration", (token) => {
      if (epoch !== registrationEpoch) {
        settleRegistration("unavailable");
        return;
      }
      const previousToken = getStoredPushToken();
      fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.value,
          previous_token: previousToken,
          platform: "ios",
          apns_environment: device.pushEnvironment,
        }),
      }).then(async (response) => {
        const payload = response.ok
          ? await response.json().catch(() => null) as { registered?: boolean } | null
          : null;
        if (payload?.registered === true) {
          if (epoch !== registrationEpoch) {
            void disablePushToken(token.value);
            settleRegistration("unavailable");
            return;
          }
          localStorage.setItem(TOKEN_KEY, token.value);
          settleRegistration("registered");
        } else if (response.ok) {
          settleRegistration("unavailable");
        } else {
          recordNativeDiagnosticEvent("push_registration_failed");
          settleRegistration("failed");
        }
      }).catch(() => {
        recordNativeDiagnosticEvent("push_registration_failed");
        settleRegistration("failed");
      });
    });
    await PushNotifications.addListener("registrationError", () => {
      recordNativeDiagnosticEvent("push_registration_failed");
      settleRegistration("failed");
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", async (action) => {
      if (action.actionId !== "tap" && action.actionId !== "RF_OPEN") return;
      const data = action.notification.data as { destination?: string; url?: string } | undefined;
      const value = data?.destination ?? data?.url;
      if (typeof value !== "string") return;
      const resolution = await resolveAuthorizedNativeLink(value, window.location.origin);
      if (resolution.kind === "unsupported") {
        recordNativeDiagnosticEvent("deep_link_unsupported");
      } else if (resolution.kind === "expired") {
        recordNativeDiagnosticEvent("deep_link_expired");
      } else if (resolution.kind === "unauthorized") {
        recordNativeDiagnosticEvent("deep_link_unauthorized");
      }
      window.location.assign(resolution.href);
    });
    await PushNotifications.register();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<PushRegistrationStatus>((resolve) => {
      timeout = setTimeout(() => {
        recordNativeDiagnosticEvent("push_registration_failed");
        resolve("failed");
      }, 10_000);
    });
    const result = await Promise.race([registrationResult, timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  } catch {
    recordNativeDiagnosticEvent("push_registration_failed");
    return "failed";
  }
}

export function registerForPush(): Promise<PushRegistrationStatus> {
  if (registrationInFlight) return registrationInFlight;
  registrationInFlight = performPushRegistration().finally(() => {
    registrationInFlight = null;
  });
  return registrationInFlight;
}
// Called on sign-out, while the session cookie still exists. Whoever signs
// in next re-registers the token to themselves; this covers the phone that
// nobody signs back in on.
export async function unregisterForPush(): Promise<void> {
  if (!isNativeApp()) return;
  registrationEpoch += 1;
  try {
    const token = getStoredPushToken();
    if (!token) return;
    if (await disablePushToken(token)) localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Best effort — sign-out must never be blocked by this.
  }
}
