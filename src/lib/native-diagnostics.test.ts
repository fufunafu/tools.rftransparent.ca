import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNativeDiagnosticReport,
  readNativeDiagnosticEvents,
  recordNativeDiagnosticEvent,
} from "@/lib/native-diagnostics";

afterEach(() => vi.unstubAllGlobals());

describe("native diagnostics", () => {
  it("contains only safe runtime and permission fields", () => {
    const report = buildNativeDiagnosticReport(
      {
        isNative: true,
        connected: true,
        connectionType: "wifi",
        offlineState: "online",
        appVersion: "1.0",
        buildNumber: "4",
        environment: "production",
        operatingSystem: "iOS 26.0",
        deviceModel: "iPhone",
        webViewLoadFailureCount: 2,
        lastWebViewLoadFailureAt: "2026-08-24T11:58:00.000Z",
        updateState: "current",
        updateUrl: null,
        serviceState: "operational",
        lastNativeCrashSignature: "exception=1 code=2 signal=6",
      },
      { notifications: "granted", location: "denied", deviceAuthentication: "granted" },
      [{ code: "cold_start", at: "2026-08-24T12:00:00.000Z" }],
    );
    expect(report).toContain("App: 1.0 (4)");
    expect(report).toContain("Location: denied");
    expect(report).toContain("WebView load failures: 2");
    expect(report).toContain("Last native crash signature: exception=1 code=2 signal=6");
    expect(report).toContain("cold_start");
    expect(report).not.toMatch(/token|latitude|longitude|password|session/i);
  });

  it("drops unknown or malformed local events before sharing diagnostics", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([
        { code: "cold_start", at: "2026-08-24T12:00:00.000Z" },
        { code: "session_token=secret", at: "2026-08-24T12:01:00.000Z" },
        { code: "plugin_failed", at: "customer@example.com" },
      ]),
    });

    expect(readNativeDiagnosticEvents()).toEqual([
      { code: "cold_start", at: "2026-08-24T12:00:00.000Z" },
    ]);
  });

  it("never interrupts app workflows when diagnostic storage is unavailable", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => "[]",
      setItem: () => {
        throw new DOMException("Storage is unavailable", "SecurityError");
      },
    });

    expect(() => recordNativeDiagnosticEvent("plugin_failed")).not.toThrow();
  });
});
