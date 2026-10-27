import type { WeekDay } from "@/lib/time-clock";

export type NativeConnectionType = "wifi" | "cellular" | "none" | "unknown";
export type OfflineState = "online" | "offline" | "restoring";

export interface NativeRuntimeState {
  isNative: boolean;
  connected: boolean;
  connectionType: NativeConnectionType;
  offlineState: OfflineState;
  appVersion: string | null;
  buildNumber: string | null;
  environment: "production" | "development" | "web";
  operatingSystem: string | null;
  deviceModel: string | null;
  nativeCrashCount?: number;
  lastNativeCrashAt?: string | null;
  lastNativeCrashSignature?: string | null;
  webViewLoadFailureCount?: number;
  lastWebViewLoadFailureAt?: string | null;
  lastLifecycleError?: string | null;
  updateState: "unknown" | "current" | "recommended" | "required";
  updateUrl: string | null;
  serviceState: "operational" | "maintenance" | "unavailable";
}

export type ClockErrorCode =
  | "unauthorized"
  | "profile_not_linked"
  | "permission_required"
  | "inaccurate_location"
  | "outside_geofence"
  | "stale_location"
  | "invalid_location"
  | "geofence_unavailable"
  | "duplicate_shift"
  | "stale_shift"
  | "no_open_shift"
  | "invalid_end_time"
  | "invalid_request"
  | "server_unavailable";

export interface MobileRoleAction {
  id: string;
  label: string;
  description: string;
  href: string;
  external?: boolean;
}

export interface MobileHomeState {
  profile: {
    id: string;
    name: string;
    department: string;
    locationName: string | null;
  } | null;
  clock: {
    linked: boolean;
    open: { id: string; clockInAt: string; stale: boolean } | null;
    week: WeekDay[];
    weekMinutes: number;
  };
  tasks: {
    active: number;
    dueToday: number;
    overdue: number;
  };
  roleActions: MobileRoleAction[];
}
