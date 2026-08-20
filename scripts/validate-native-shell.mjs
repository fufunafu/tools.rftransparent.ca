import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const checks = [
  ["capacitor.config.ts", /launchAutoHide:\s*true/, "bounded splash-screen fallback"],
  ["capacitor.config.ts", /launchShowDuration:\s*10_000/, "ten-second splash-screen fallback"],
  ["capacitor.config.ts", /errorPath:\s*["']offline\.html["']/, "offline load-error page"],
  ["capacitor.config.ts", /allowNavigation:\s*\[\]/, "restricted WebView navigation"],
  ["capacitor\/www\/offline.html", /id=["']retry["']/, "offline Retry control"],
  ["capacitor\/www\/offline.html", /Contact support/, "offline support link"],
  ["ios\/App\/App\/SceneDelegate.swift", /sceneWillResignActive/, "background privacy cover"],
  ["ios\/App\/App\/SceneDelegate.swift", /privacyView/, "privacy-cover lifecycle"],
  ["ios\/App\/App\/SceneDelegate.swift", /RFNavigationGuardPlugin/, "exact-origin native navigation guard"],
  ["ios\/App\/App\/SceneDelegate.swift", /hasSameOrigin/, "exact native origin comparison"],
  ["ios\/App\/App\/SceneDelegate.swift", /\["mailto", "tel", "sms"\]/, "native support-link handoff"],
  ["ios\/App\/App\/Info.plist", /unlock your existing signed-in session/, "session-based Face ID education"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /Validate Release Server/, "Xcode release-server build guard"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /Release builds cannot contain a local server or cleartext setting/, "Xcode local-server rejection"],
  ["src\/components\/NativeAppRuntime.tsx", /appStateChange/, "foreground refresh and re-lock"],
  ["src\/components\/NativeAppRuntime.tsx", /isTrustedAppUrl/, "external navigation boundary"],
  ["src\/components\/NativeAppRuntime.tsx", /Browser\.open/, "external system-browser handoff"],
  ["src\/components\/NativeAppRuntime.tsx", /networkStatusChange/, "native network recovery"],
  ["src\/components\/NativeAppRuntime.tsx", /StatusBar\.setStyle/, "native status-bar appearance"],
  ["src\/lib\/app-biometrics.ts", /clearLegacySavedCredentials/, "legacy credential migration"],
  ["supabase\/migrations\/20260813233000_time_entry_location_audit.sql", /clock_in_accuracy_m/, "clock-in accuracy audit field"],
  ["supabase\/migrations\/20260813233000_time_entry_location_audit.sql", /clock_in_position_captured_at/, "clock-in capture-time audit field"],
];

let failed = false;
for (const [path, pattern, label] of checks) {
  if (!pattern.test(read(path))) {
    console.error(`Native shell validation failed: missing ${label} in ${path}.`);
    failed = true;
  }
}
if (/SecureStorage\.set/.test(read("src/lib/app-biometrics.ts"))) {
  console.error("Native shell validation failed: app biometrics writes secure-storage credentials.");
  failed = true;
}
if (/fetch\(["']\/api\/logout["']/.test(read("src/components/NativeAppRuntime.tsx"))) {
  console.error("Native shell validation failed: an unavailable device unlock must not invalidate a valid server session.");
  failed = true;
}
if (failed) process.exit(1);
console.log("Native shell reliability and privacy checks passed.");
