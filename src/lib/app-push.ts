// Push-notification registration for the iOS app. Browser and home-screen
// installs never load the plugin (dynamic import), and every function is a
// quiet no-op outside the native shell.

import { isNativeApp } from "@/lib/app-biometrics";

// iOS only shows the permission dialog once per install; this marker keeps
// us from re-asking a user who dismissed it every single launch.
const PROMPTED_KEY = "rf-push-prompted";

// The device token APNs last handed us, kept so sign-out can tell the server
// to stop notifying this phone.
const TOKEN_KEY = "rf-push-token";

export async function registerForPush(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt") {
      if (localStorage.getItem(PROMPTED_KEY)) return;
      localStorage.setItem(PROMPTED_KEY, "1");
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") return;

    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener("registration", (token) => {
      localStorage.setItem(TOKEN_KEY, token.value);
      // Fire-and-forget; a failed save self-heals on the next launch.
      fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.value, platform: "ios" }),
      }).catch(() => {});
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = (action.notification.data as { url?: string } | undefined)?.url;
      if (typeof url === "string" && url.startsWith("/")) window.location.href = url;
    });
    await PushNotifications.register();
  } catch {
    // Notifications are an enhancement — never let them break the app.
  }
}

// Called on sign-out, while the session cookie still exists. Whoever signs
// in next re-registers the token to themselves; this covers the phone that
// nobody signs back in on.
export async function unregisterForPush(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const res = await fetch(`/api/push/register?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    if (res.ok) localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Best effort — sign-out must never be blocked by this.
  }
}
