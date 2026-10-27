import type { NativeRuntimeState } from "@/lib/mobile-types";
import type { NativePermissionSnapshot } from "@/lib/native-support";

const STORAGE_KEY = "rf-native-diagnostic-events";
const MAX_EVENTS = 25;

export type NativeDiagnosticEventCode =
  | "cold_start"
  | "webview_ready"
  | "webview_load_failed"
  | "plugin_failed"
  | "session_check_failed"
  | "device_unlock_failed"
  | "version_check_failed"
  | "maintenance_check_failed"
  | "deep_link_unsupported"
  | "deep_link_expired"
  | "deep_link_unauthorized"
  | "push_registration_failed"
  | "javascript_error"
  | "unhandled_rejection";

const EVENT_CODES = new Set<NativeDiagnosticEventCode>([
  "cold_start",
  "webview_ready",
  "webview_load_failed",
  "plugin_failed",
  "session_check_failed",
  "device_unlock_failed",
  "version_check_failed",
  "maintenance_check_failed",
  "deep_link_unsupported",
  "deep_link_expired",
  "deep_link_unauthorized",
  "push_registration_failed",
  "javascript_error",
  "unhandled_rejection",
]);

function isDiagnosticEventCode(value: unknown): value is NativeDiagnosticEventCode {
  return typeof value === "string" && EVENT_CODES.has(value as NativeDiagnosticEventCode);
}

export interface NativeDiagnosticEvent {
  code: NativeDiagnosticEventCode;
  at: string;
}

export function readNativeDiagnosticEvents(): NativeDiagnosticEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is NativeDiagnosticEvent =>
        typeof item === "object" &&
        item !== null &&
        isDiagnosticEventCode((item as NativeDiagnosticEvent).code) &&
        typeof (item as NativeDiagnosticEvent).at === "string" &&
        Number.isFinite(Date.parse((item as NativeDiagnosticEvent).at)),
    ).slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

export function recordNativeDiagnosticEvent(code: NativeDiagnosticEventCode): void {
  if (typeof window === "undefined") return;
  try {
    const events = [...readNativeDiagnosticEvents(), { code, at: new Date().toISOString() }]
      .slice(-MAX_EVENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics are best effort and must never interrupt an app workflow.
  }
}

export function buildNativeDiagnosticReport(
  runtime: NativeRuntimeState,
  permissions: NativePermissionSnapshot,
  events = readNativeDiagnosticEvents(),
): string {
  const lines = [
    "RF Tools diagnostics",
    `App: ${runtime.appVersion ?? "unknown"} (${runtime.buildNumber ?? "unknown"})`,
    `Environment: ${runtime.environment}`,
    `Connection: ${runtime.connected ? runtime.connectionType : "offline"}`,
    `Operating system: ${runtime.operatingSystem ?? "unknown"}`,
    `Device: ${runtime.deviceModel ?? "unknown"}`,
    `Native crash reports: ${runtime.nativeCrashCount ?? 0}`,
    `Last native crash: ${runtime.lastNativeCrashAt ?? "none"}`,
    `Last native crash signature: ${runtime.lastNativeCrashSignature ?? "none"}`,
    `WebView load failures: ${runtime.webViewLoadFailureCount ?? 0}`,
    `Last WebView load failure: ${runtime.lastWebViewLoadFailureAt ?? "none"}`,
    `Last lifecycle error: ${runtime.lastLifecycleError ?? "none"}`,
    `Notifications: ${permissions.notifications}`,
    `Location: ${permissions.location}`,
    `Device authentication: ${permissions.deviceAuthentication}`,
    `Update state: ${runtime.updateState}`,
    `Service state: ${runtime.serviceState}`,
    "Recent technical events:",
    ...events.map((event) => `${event.at} ${event.code}`),
  ];
  return lines.join("\n");
}
