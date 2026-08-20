// Haptic feedback in the iOS app — a physical tick on clock in/out. No-ops
// everywhere else; the plugin never enters the web bundle.

import { isNativeApp } from "@/lib/app-biometrics";

export async function hapticSuccess(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Feedback only — never worth an error.
  }
}

export async function hapticWarning(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    // Feedback only — never worth an error.
  }
}
