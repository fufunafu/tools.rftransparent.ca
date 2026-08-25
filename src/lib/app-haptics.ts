// Haptic feedback in the iOS app — a physical tick on clock in/out. No-ops
// everywhere else; the plugin never enters the web bundle.

import { isNativeApp } from "@/lib/app-biometrics";
import { recordNativeDiagnosticEvent } from "@/lib/native-diagnostics";

export async function hapticSuccess(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    recordNativeDiagnosticEvent("plugin_failed");
    // Feedback remains optional and must not interrupt a clock action.
  }
}

export async function hapticWarning(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    recordNativeDiagnosticEvent("plugin_failed");
    // Feedback remains optional and must not interrupt recovery guidance.
  }
}
