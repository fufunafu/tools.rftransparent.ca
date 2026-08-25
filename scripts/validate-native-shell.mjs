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
  ["ios\/App\/App\/SceneDelegate.swift", /sceneWillResignActive/, "background privacy-cover lifecycle"],
  ["ios\/App\/App\/Application\/RFPrivacyShieldController.swift", /rf-privacy-shield/, "background privacy cover"],
  ["ios\/App\/App\/Application\/RFNavigationGuardPlugin.swift", /RFNavigationGuardPlugin/, "exact-origin native navigation guard"],
  ["ios\/App\/App\/Application\/RFNavigationPolicy.swift", /hasSameOrigin/, "exact native origin comparison"],
  ["ios\/App\/App\/Application\/RFNavigationGuardPlugin.swift", /\["mailto", "tel", "sms"\]/, "native support-link handoff"],
  ["ios\/App\/App\/Application\/RFBridgeViewController.swift", /registerPluginInstance/, "native bridge plugin registration"],
  ["ios\/App\/App\/Application\/RFBridgeViewController.swift", /scheduleLoadFailureFallback/, "bounded native load-failure fallback"],
  ["ios\/App\/App\/Application\/RFBridgeViewController.swift", /dataset\.rfAppReady/, "explicit web-runtime readiness handshake"],
  ["ios\/App\/App\/Application\/RFNativeSupportPlugin.swift", /openSettings/, "native Settings recovery"],
  ["ios\/App\/App\/Application\/RFNativeSupportPlugin.swift", /getLocationAuthorizationStatus/, "distinct native location authorization states"],
  ["ios\/App\/App\/Application\/RFNativeSupportPlugin.swift", /hidePrivacyShield/, "foreground privacy-shield handshake"],
  ["ios\/App\/App\/Application\/RFNativeSupportPlugin.swift", /retryRemoteLoad/, "native recovery retry handoff"],
  ["ios\/App\/App\/Application\/RFNativeSupportPlugin.swift", /getServiceStatus/, "bundled native maintenance lookup"],
  ["capacitor\/www\/offline.html", /retryRemoteLoad/, "bundled recovery native retry handoff"],
  ["capacitor\/www\/offline.html", /hidePrivacyShield/, "bundled recovery privacy-shield handshake"],
  ["capacitor\/www\/offline.html", /dataset\.rfAppReady/, "bundled recovery readiness handshake"],
  ["ios\/App\/App\/Application\/RFNotificationCategories.swift", /RF_OVERDUE/, "overdue-work notification category"],
  ["ios\/App\/App\/Application\/RFNotificationCategories.swift", /RF_CALLBACK/, "operational notification categories"],
  ["ios\/App\/App\/Application\/RFMetricDiagnostics.swift", /MXMetricManagerSubscriber/, "privacy-conscious native crash diagnostics"],
  ["ios\/App\/App\/Application\/RFMetricDiagnostics.swift", /recordWebViewLoadFailure/, "persistent WebView load-failure diagnostics"],
  ["capacitor\/www\/offline.html", /recordWebViewLoadFailure/, "bundled load-failure reporting"],
  ["ios\/App\/App\/App.entitlements", /applinks:tools\.rftransparent\.ca/, "Associated Domains entitlement"],
  ["ios\/App\/App\/App.Debug.entitlements", /<string>development<\/string>/, "sandbox APNs entitlement for Debug builds"],
  ["public\/.well-known\/apple-app-site-association", /94BK7NCPL9\.ca\.rftransparent\.tools/, "universal-link association"],
  ["ios\/App\/project.yml", /AppUITests:/, "reproducible native UI-test target"],
  ["ios\/App\/project.yml", /AppTests:/, "reproducible native unit-test target"],
  ["ios\/App\/AppUITests\/RFAppUITests.swift", /testColdLaunchCreatesBrandedNativeRootAndWebView/, "native cold-launch UI test"],
  ["ios\/App\/AppUITests\/RFAppUITests.swift", /testReturningToForegroundRequestsFreshContent/, "native foreground-refresh UI test"],
  ["ios\/App\/AppUITests\/RFAppUITests.swift", /testOfflineColdLaunchShowsBundledRecoveryAndRetry/, "native offline cold-launch UI test"],
  ["ios\/App\/AppUITests\/RFAppUITests.swift", /testBundledRecoveryDistinguishesPlannedMaintenance/, "bundled maintenance UI test"],
  ["scripts\/run-ios-tests.mjs", /killSignal:\s*"SIGKILL"/, "enforced native test operation timeout"],
  ["src\/lib\/native-links.ts", /resolveNativeLink/, "safe deep-link routing"],
  ["src\/lib\/native-update.ts", /evaluateNativeUpdate/, "native build update policy"],
  ["src\/components\/NativeSettingsPanel.tsx", /Share diagnostics/, "native support diagnostics"],
  ["supabase\/migrations\/20260824153000_push_preferences.sql", /clock_reminders/, "per-device notification preferences"],
  ["supabase\/migrations\/20260824153000_push_preferences.sql", /overdue_updates/, "overdue-work notification preference"],
  ["supabase\/migrations\/20260824153000_push_preferences.sql", /apns_environment/, "per-token APNs environment"],
  ["src\/lib\/apns.ts", /sendRegisteredPush/, "sandbox and production APNs routing"],
  ["capacitor\/www\/offline.html", /Internet available · service unavailable/, "distinct service failure recovery"],
  ["capacitor\/www\/offline.html", /planned maintenance/, "bundled maintenance recovery"],
  ["ios\/App\/App\/Info.plist", /unlock your existing signed-in session/, "session-based Face ID education"],
  ["ios\/App\/App\/PrivacyInfo.xcprivacy", /NSPrivacyCollectedDataTypePreciseLocation/, "App Store privacy declaration"],
  ["ios\/App\/App\/PrivacyInfo.xcprivacy", /NSPrivacyAccessedAPICategoryUserDefaults/, "UserDefaults required-reason declaration"],
  ["ios\/App\/App\/PrivacyInfo.xcprivacy", /CA92\.1/, "app-only UserDefaults reason"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /PrivacyInfo\.xcprivacy in Resources/, "privacy manifest target membership"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /Validate Release Server/, "Xcode release-server build guard"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /Release builds cannot contain a local server or cleartext setting/, "Xcode local-server rejection"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /AppUITests/, "Xcode UI-test target"],
  ["ios\/App\/App\.xcodeproj\/project\.pbxproj", /AppTests/, "Xcode unit-test target"],
  ["src\/components\/NativeAppRuntime.tsx", /appStateChange/, "foreground refresh and re-lock"],
  ["src\/components\/NativeAppRuntime.tsx", /isTrustedAppUrl/, "external navigation boundary"],
  ["src\/components\/NativeAppRuntime.tsx", /Browser\.open/, "external system-browser handoff"],
  ["src\/components\/NativeAppRuntime.tsx", /networkStatusChange/, "native network recovery"],
  ["src\/components\/NativeAppRuntime.tsx", /StatusBar\.setStyle/, "native status-bar appearance"],
  ["src\/app\/globals.css", /font:\s*-apple-system-body/, "native Dynamic Type scaling"],
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
const sceneDelegate = read("ios/App/App/SceneDelegate.swift");
const productionSceneBody = sceneDelegate.replace(/#if DEBUG[\s\S]*?#endif/g, "");
if (/schedulePrivacyShieldFallback/.test(productionSceneBody.split("private func schedulePrivacyShieldFallback")[0] ?? "")) {
  console.error("Native shell validation failed: production privacy shield uses an automatic removal timer.");
  failed = true;
}
if (failed) process.exit(1);
console.log("Native shell reliability and privacy checks passed.");
