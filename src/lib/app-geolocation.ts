// The phone's position, for geofenced clock-in. Inside the iOS app the
// native Capacitor plugin drives the permission prompt; in a regular browser
// or home-screen install it falls back to the standard web geolocation API.
// Dynamically imported so the plugin never lands in the web bundle.

import { isNativeApp } from "@/lib/app-biometrics";
import {
  GEOFENCE_MAX_ACCEPTABLE_ACCURACY_M,
  isValidLatitude,
  isValidLongitude,
} from "@/lib/time-clock";

export interface AppPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

export type PositionResult =
  | { ok: true; position: AppPosition }
  | { ok: false; reason: "denied" | "restricted" | "timeout" | "unavailable" }
  | { ok: false; reason: "inaccurate"; accuracy: number };

const OPTIONS = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 };

function toResult(position: {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number };
}): PositionResult {
  if (
    !Number.isFinite(position.timestamp) ||
    !isValidLatitude(position.coords.latitude) ||
    !isValidLongitude(position.coords.longitude) ||
    !Number.isFinite(position.coords.accuracy) ||
    position.coords.accuracy < 0
  ) {
    return { ok: false, reason: "unavailable" };
  }
  if (position.coords.accuracy > GEOFENCE_MAX_ACCEPTABLE_ACCURACY_M) {
    return { ok: false, reason: "inaccurate", accuracy: Math.round(position.coords.accuracy) };
  }
  return {
    ok: true,
    position: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      capturedAt: new Date(position.timestamp).toISOString(),
    },
  };
}

export async function getCurrentPosition(): Promise<PositionResult> {
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      let permission = await Geolocation.checkPermissions();
      if (permission.location === "prompt" || permission.location === "prompt-with-rationale") {
        permission = await Geolocation.requestPermissions({ permissions: ["location"] });
      }
      if (permission.location === "denied") return { ok: false, reason: "denied" };
      if (permission.location !== "granted") return { ok: false, reason: "restricted" };
      const pos = await Geolocation.getCurrentPosition(OPTIONS);
      return toResult(pos);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/denied|permission/i.test(message)) return { ok: false, reason: "denied" };
      if (/restricted/i.test(message)) return { ok: false, reason: "restricted" };
      if (/timeout|timed out/i.test(message)) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "unavailable" };
    }
  }

  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toResult(pos)),
      (err) =>
        resolve({
          ok: false,
          reason:
            err.code === err.PERMISSION_DENIED
              ? "denied"
              : err.code === err.TIMEOUT
                ? "timeout"
                : "unavailable",
        }),
      OPTIONS,
    );
  });
}
