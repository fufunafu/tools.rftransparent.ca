import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkPermissions, requestPermissions, nativePosition } = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  nativePosition: vi.fn(),
}));

vi.mock("@/lib/app-biometrics", () => ({ isNativeApp: () => true }));
vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    checkPermissions,
    requestPermissions,
    getCurrentPosition: nativePosition,
  },
}));

import { getCurrentPosition } from "@/lib/app-geolocation";

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissions.mockResolvedValue({ location: "granted" });
  requestPermissions.mockResolvedValue({ location: "granted" });
  nativePosition.mockResolvedValue({
    timestamp: Date.now(),
    coords: { latitude: 43.65, longitude: -79.38, accuracy: 12 },
  });
});

describe("native location permission handling", () => {
  it("requests permission only after a prompt state", async () => {
    checkPermissions.mockResolvedValue({ location: "prompt" });
    const result = await getCurrentPosition();
    expect(requestPermissions).toHaveBeenCalledWith({ permissions: ["location"] });
    expect(result).toMatchObject({ ok: true });
  });

  it("returns an actionable denied state", async () => {
    checkPermissions.mockResolvedValue({ location: "denied" });
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "denied" });
    expect(nativePosition).not.toHaveBeenCalled();
  });

  it("distinguishes a restricted permission state", async () => {
    checkPermissions.mockResolvedValue({ location: "limited" });
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "restricted" });
  });

  it("recovers after location permission is changed in Settings", async () => {
    checkPermissions
      .mockResolvedValueOnce({ location: "denied" })
      .mockResolvedValueOnce({ location: "granted" });

    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "denied" });
    await expect(getCurrentPosition()).resolves.toMatchObject({ ok: true });
    expect(nativePosition).toHaveBeenCalledTimes(1);
  });

  it("rejects an inaccurate fix before clock submission", async () => {
    nativePosition.mockResolvedValue({
      timestamp: Date.now(),
      coords: { latitude: 43.65, longitude: -79.38, accuracy: 250 },
    });
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "inaccurate", accuracy: 250 });
  });

  it("distinguishes a location timeout", async () => {
    nativePosition.mockRejectedValue(new Error("Location request timed out"));
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("reports an unavailable native location service", async () => {
    nativePosition.mockRejectedValue(new Error("Position unavailable"));
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it.each([
    { latitude: 91, longitude: -79.38, accuracy: 12 },
    { latitude: 43.65, longitude: Number.NaN, accuracy: 12 },
    { latitude: 43.65, longitude: -79.38, accuracy: -1 },
    { latitude: 43.65, longitude: -79.38, accuracy: Number.POSITIVE_INFINITY },
  ])("rejects an invalid native fix before submission", async (coords) => {
    nativePosition.mockResolvedValue({ timestamp: Date.now(), coords });
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
