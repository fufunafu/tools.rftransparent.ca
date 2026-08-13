// The phone's position, for geofenced clock-in. Inside the iOS app the
// native Capacitor plugin drives the permission prompt; in a regular browser
// or home-screen install it falls back to the standard web geolocation API.
// Dynamically imported so the plugin never lands in the web bundle.

import { isNativeApp } from "@/lib/app-biometrics";

export interface AppPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type PositionResult =
  | { ok: true; position: AppPosition }
  | { ok: false; reason: "denied" | "unavailable" };

const OPTIONS = { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 };

export async function getCurrentPosition(): Promise<PositionResult> {
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition(OPTIONS);
      return {
        ok: true,
        position: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: /denied|permission/i.test(message) ? "denied" : "unavailable" };
    }
  }

  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          position: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        }),
      (err) =>
        resolve({ ok: false, reason: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      OPTIONS,
    );
  });
}
