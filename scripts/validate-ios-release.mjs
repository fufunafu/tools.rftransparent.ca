import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const productionUrl = "https://tools.rftransparent.ca";
const capBinary = resolve(projectRoot, "node_modules/.bin/cap");
const minimumIosSdkMajor = 26;

function fail(message) {
  console.error(`iOS release validation failed: ${message}`);
  process.exitCode = 1;
}

function evaluateConfig() {
  const output = execFileSync(capBinary, ["config", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CAPACITOR_SERVER_URL: productionUrl,
      CAPACITOR_ALLOW_CLEARTEXT: "0",
    },
  });
  return JSON.parse(output);
}

function parsePlist(path) {
  const output = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function inspectImage(path) {
  const output = execFileSync(
    "/usr/bin/sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", path],
    { cwd: projectRoot, encoding: "utf8" },
  );
  return {
    width: Number.parseInt(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? "", 10),
    height: Number.parseInt(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? "", 10),
    hasAlpha: output.match(/hasAlpha:\s*(\w+)/)?.[1] ?? "unknown",
  };
}

function metadataValue(metadata, label) {
  return metadata.match(new RegExp(`^- ${label}: \\x60([^\\x60]+)\\x60$`, "m"))?.[1] ?? null;
}

const evaluatedResult = evaluateConfig();
const evaluated = evaluatedResult.app?.extConfig;
const embeddedPath = resolve(projectRoot, "ios/App/App/capacitor.config.json");
const embedded = JSON.parse(readFileSync(embeddedPath, "utf8"));
const infoPlist = readFileSync(resolve(projectRoot, "ios/App/App/Info.plist"), "utf8");
const entitlements = readFileSync(resolve(projectRoot, "ios/App/App/App.entitlements"), "utf8");
const debugEntitlements = readFileSync(resolve(projectRoot, "ios/App/App/App.Debug.entitlements"), "utf8");
const projectFile = readFileSync(resolve(projectRoot, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
const projectSpec = readFileSync(resolve(projectRoot, "ios/App/project.yml"), "utf8");
const versionPolicyRoute = readFileSync(resolve(projectRoot, "src/app/api/native/version/route.ts"), "utf8");
const nativeLinksSource = readFileSync(resolve(projectRoot, "src/lib/native-links.ts"), "utf8");
const pushPreferencesMigration = readFileSync(
  resolve(projectRoot, "supabase/migrations/20260824153000_push_preferences.sql"),
  "utf8",
);
const privacyManifestPath = resolve(projectRoot, "ios/App/App/PrivacyInfo.xcprivacy");
const privacyManifest = parsePlist(privacyManifestPath);
const exportOptions = parsePlist(resolve(projectRoot, "ios/App/ExportOptions.plist"));
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
const archiveScript = readFileSync(resolve(projectRoot, "scripts/archive-ios.mjs"), "utf8");
const metadata = readFileSync(resolve(projectRoot, "app-store-assets/submission-metadata.md"), "utf8");
const marketingVersion = projectSpec.match(/MARKETING_VERSION:\s*["']?([0-9]+(?:\.[0-9]+){1,2})["']?/)?.[1] ?? null;
const nativeBuild = projectSpec.match(/CURRENT_PROJECT_VERSION:\s*["']?(\d+)["']?/)?.[1] ?? null;
const policyBuild = versionPolicyRoute.match(/const CURRENT_NATIVE_BUILD = (\d+);/)?.[1] ?? null;

if (!marketingVersion) fail("XcodeGen project.yml is missing a valid MARKETING_VERSION.");
if (!nativeBuild) fail("XcodeGen project.yml is missing a valid CURRENT_PROJECT_VERSION.");
if (!policyBuild) fail("the native version endpoint is missing CURRENT_NATIVE_BUILD.");
if (nativeBuild && policyBuild && nativeBuild !== policyBuild) {
  fail(`the Xcode build ${nativeBuild} does not match the native version endpoint build ${policyBuild}.`);
}

if (exportOptions.method !== "app-store-connect") {
  fail("ExportOptions.plist must use the app-store-connect distribution method.");
}
if (exportOptions.destination !== "upload") {
  fail("ExportOptions.plist must upload the validated archive to App Store Connect.");
}
if (exportOptions.manageAppVersionAndBuildNumber !== false) {
  fail("ExportOptions.plist must preserve the validated version and build number during export.");
}
if (packageJson.scripts?.["ios:export"] !== "IOS_EXPORT_ARCHIVE=1 node scripts/archive-ios.mjs") {
  fail("ios:export must use the local-only archive export path.");
}
if (packageJson.scripts?.["ios:testflight"] !== "IOS_UPLOAD_TESTFLIGHT=1 node scripts/archive-ios.mjs") {
  fail("ios:testflight must be the only package command that requests a TestFlight upload.");
}
if (
  !archiveScript.includes('process.env.IOS_UPLOAD_TESTFLIGHT !== "1"') ||
  !archiveScript.includes('"-replace", "destination", "-string", "export"')
) {
  fail("the archive script must derive export-only options for local IPA exports.");
}

const sdkVersion = execFileSync("/usr/bin/xcrun", ["--sdk", "iphoneos", "--show-sdk-version"], {
  cwd: projectRoot,
  encoding: "utf8",
}).trim();
const sdkMajor = Number.parseInt(sdkVersion, 10);
if (!Number.isFinite(sdkMajor) || sdkMajor < minimumIosSdkMajor) {
  fail(`App Store uploads require the iOS ${minimumIosSdkMajor} SDK or later; found ${sdkVersion || "an unknown version"}.`);
}

for (const [label, config] of [
  ["evaluated source", evaluated],
  ["embedded iOS", embedded],
]) {
  if (config.server?.url !== productionUrl) {
    fail(`${label} config must target ${productionUrl}.`);
  }
  if (config.server?.cleartext === true) {
    fail(`${label} config enables cleartext traffic.`);
  }
  if ((config.server?.allowNavigation ?? []).length !== 0) {
    fail(`${label} config allows additional in-WebView navigation hosts.`);
  }
  if (config.server?.errorPath !== "offline.html") {
    fail(`${label} config must use offline.html as its load-error page.`);
  }
  if (config.plugins?.SplashScreen?.launchAutoHide !== true) {
    fail(`${label} config must provide a bounded splash-screen fallback.`);
  }
  if (config.plugins?.SplashScreen?.launchShowDuration !== 10_000) {
    fail(`${label} config must reveal load failures after ten seconds.`);
  }
  if (config.ios?.webContentsDebuggingEnabled === true) {
    fail(`${label} config enables production WebView debugging.`);
  }
}

if (/localhost|127\.0\.0\.1/i.test(JSON.stringify(embedded))) {
  fail("embedded iOS config contains a local development host.");
}

if (/NSAllowsArbitraryLoads/.test(infoPlist)) {
  fail("Info.plist contains NSAllowsArbitraryLoads.");
}

const appStoreFields = [
  ["App name", 30, "characters"],
  ["Subtitle", 30, "characters"],
  ["Promotional text", 170, "characters"],
  ["Keywords", 100, "bytes"],
];
for (const [label, limit, unit] of appStoreFields) {
  const value = metadataValue(metadata, label);
  if (!value) {
    fail(`App Store metadata is missing ${label}.`);
    continue;
  }
  const length = unit === "bytes" ? Buffer.byteLength(value, "utf8") : [...value].length;
  if (length > limit) fail(`${label} exceeds Apple's ${limit}-${unit} limit.`);
}

for (const [label, expected] of [
  ["Bundle ID", "ca.rftransparent.tools"],
  ["Version", marketingVersion],
  ["Build", nativeBuild],
  ["Support URL", "https://tools.rftransparent.ca/support"],
  ["Marketing URL", "https://rftransparent.ca/"],
]) {
  if (metadataValue(metadata, label) !== expected) {
    fail(`App Store metadata ${label} must be ${expected}.`);
  }
}

for (const expected of [
  `MARKETING_VERSION = ${marketingVersion};`,
  `CURRENT_PROJECT_VERSION = ${nativeBuild};`,
  "PRODUCT_BUNDLE_IDENTIFIER = ca.rftransparent.tools;",
]) {
  if (!projectFile.includes(expected)) fail(`Xcode project is missing ${expected}`);
}

const expectedScreenshots = ["01-sign-in.jpg", "02-daily-home.jpg", "03-clock.jpg", "04-tasks.jpg"];
for (const [directory, expectedWidth, expectedHeight] of [
  ["iphone-6.9", 1320, 2868],
  ["ipad-13", 2064, 2752],
]) {
  const screenshotDirectory = resolve(projectRoot, "app-store-assets/screenshots", directory);
  const files = readdirSync(screenshotDirectory).filter((file) => !file.startsWith(".")).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedScreenshots)) {
    fail(`${directory} must contain the four approved screenshots in filename order.`);
    continue;
  }
  for (const file of files) {
    const details = inspectImage(resolve(screenshotDirectory, file));
    if (details.width !== expectedWidth || details.height !== expectedHeight) {
      fail(`${directory}/${file} is ${details.width}x${details.height}; expected ${expectedWidth}x${expectedHeight}.`);
    }
    if (details.hasAlpha !== "no") fail(`${directory}/${file} must not contain an alpha channel.`);
  }
}

const icon = inspectImage(resolve(projectRoot, "ios/App/App/Assets.xcassets/AppIcon.appiconset/RF-Tools-AppIcon-1024.png"));
if (icon.width !== 1024 || icon.height !== 1024 || icon.hasAlpha !== "no") {
  fail("the App Store icon must be an opaque 1024x1024 image.");
}

if (!/PrivacyInfo\.xcprivacy in Resources/.test(projectFile)) {
  fail("the app privacy manifest is not included in the Xcode target resources.");
}

if (privacyManifest.NSPrivacyTracking !== false) {
  fail("the app privacy manifest must declare that RF Tools does not track users.");
}

if ((privacyManifest.NSPrivacyTrackingDomains ?? []).length !== 0) {
  fail("the app privacy manifest contains tracking domains.");
}

const accessedApiTypes = privacyManifest.NSPrivacyAccessedAPITypes ?? [];
if (
  accessedApiTypes.length !== 1 ||
  accessedApiTypes[0]?.NSPrivacyAccessedAPIType !== "NSPrivacyAccessedAPICategoryUserDefaults" ||
  JSON.stringify(accessedApiTypes[0]?.NSPrivacyAccessedAPITypeReasons) !== JSON.stringify(["CA92.1"])
) {
  fail("the app privacy manifest must declare app-only UserDefaults access with reason CA92.1.");
}

const expectedCollectedDataTypes = new Set([
  "NSPrivacyCollectedDataTypeName",
  "NSPrivacyCollectedDataTypeEmailAddress",
  "NSPrivacyCollectedDataTypePreciseLocation",
  "NSPrivacyCollectedDataTypePhotosorVideos",
  "NSPrivacyCollectedDataTypeCustomerSupport",
  "NSPrivacyCollectedDataTypeOtherUserContent",
  "NSPrivacyCollectedDataTypeUserID",
  "NSPrivacyCollectedDataTypeDeviceID",
]);
const collectedDataTypes = privacyManifest.NSPrivacyCollectedDataTypes ?? [];
for (const declaration of collectedDataTypes) {
  const type = declaration.NSPrivacyCollectedDataType;
  if (!expectedCollectedDataTypes.delete(type)) {
    fail(`the app privacy manifest contains an unexpected or duplicate data type: ${type}.`);
  }
  if (declaration.NSPrivacyCollectedDataTypeLinked !== true) {
    fail(`${type} must remain linked to the user's identity in the privacy declaration.`);
  }
  if (declaration.NSPrivacyCollectedDataTypeTracking !== false) {
    fail(`${type} must not be used for tracking.`);
  }
  const purposes = declaration.NSPrivacyCollectedDataTypePurposes ?? [];
  if (purposes.length !== 1 || purposes[0] !== "NSPrivacyCollectedDataTypePurposeAppFunctionality") {
    fail(`${type} must be declared only for App Functionality.`);
  }
}
for (const missingType of expectedCollectedDataTypes) {
  fail(`the app privacy manifest is missing ${missingType}.`);
}

const requiredPlugins = [
  "AppPlugin",
  "BiometricAuthNative",
  "CAPBrowserPlugin",
  "GeolocationPlugin",
  "HapticsPlugin",
  "KeyboardPlugin",
  "CAPNetworkPlugin",
  "PushNotificationsPlugin",
  "SecureStorage",
  "SplashScreenPlugin",
  "StatusBarPlugin",
];
const registered = new Set(embedded.packageClassList ?? []);
for (const plugin of requiredPlugins) {
  if (!registered.has(plugin)) fail(`embedded iOS config is missing ${plugin}.`);
}

for (const preference of [
  "task_updates",
  "overdue_updates",
  "clock_reminders",
  "followup_updates",
  "callback_updates",
]) {
  if (!pushPreferencesMigration.includes(preference)) {
    fail(`the push preferences migration is missing ${preference}.`);
  }
}

if (!entitlements.includes("applinks:tools.rftransparent.ca")) {
  fail("the app is missing the production Associated Domains entitlement.");
}
if (!/<key>aps-environment<\/key>\s*<string>production<\/string>/.test(entitlements)) {
  fail("the app is missing the production APNs entitlement.");
}
if (!/<key>aps-environment<\/key>\s*<string>development<\/string>/.test(debugEntitlements)) {
  fail("the Debug app is missing the sandbox APNs entitlement.");
}
if (!debugEntitlements.includes("applinks:tools.rftransparent.ca")) {
  fail("the Debug app is missing the production Associated Domains entitlement.");
}
if (!projectSpec.includes("CODE_SIGN_ENTITLEMENTS: App/App.Debug.entitlements")) {
  fail("XcodeGen does not select the Debug APNs entitlements file.");
}
if (!projectSpec.includes("CODE_SIGN_ENTITLEMENTS: App/App.entitlements")) {
  fail("XcodeGen does not select the Release APNs entitlements file.");
}

const associationRoot = readFileSync(resolve(projectRoot, "public/apple-app-site-association"), "utf8");
const associationWellKnown = readFileSync(resolve(projectRoot, "public/.well-known/apple-app-site-association"), "utf8");
if (associationRoot !== associationWellKnown) {
  fail("the two apple-app-site-association files must be identical.");
}
const association = JSON.parse(associationRoot);
const appIDs = association.applinks?.details?.flatMap((detail) => detail.appIDs ?? []) ?? [];
if (!appIDs.includes("94BK7NCPL9.ca.rftransparent.tools")) {
  fail("apple-app-site-association is missing the production app identifier.");
}
const destinationBlock = nativeLinksSource.match(
  /const EXACT_DESTINATIONS = new Set\(\[([\s\S]*?)\]\);/,
)?.[1];
const nativeDestinations = destinationBlock
  ? [...destinationBlock.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]).sort()
  : [];
const associatedPaths = (association.applinks?.details ?? [])
  .flatMap((detail) => detail.components ?? [])
  .map((component) => component["/"])
  .filter((path) => typeof path === "string")
  .sort();
if (
  nativeDestinations.length === 0 ||
  JSON.stringify(nativeDestinations) !== JSON.stringify(associatedPaths)
) {
  fail("the native route allowlist and apple-app-site-association paths must match exactly.");
}

if (process.env.IOS_UPDATE_URL) {
  let updateURL;
  try {
    updateURL = new URL(process.env.IOS_UPDATE_URL);
  } catch {
    updateURL = null;
  }
  const appleHosts = new Set(["apps.apple.com", "itunes.apple.com", "testflight.apple.com"]);
  if (!updateURL || updateURL.protocol !== "https:" || !appleHosts.has(updateURL.hostname.toLowerCase())) {
    fail("IOS_UPDATE_URL must be an HTTPS TestFlight or App Store destination.");
  }
}

if (process.env.IOS_CURRENT_VERSION && process.env.IOS_CURRENT_VERSION !== marketingVersion) {
  fail(`IOS_CURRENT_VERSION must match Xcode MARKETING_VERSION ${marketingVersion}.`);
}

for (const name of ["IOS_MINIMUM_BUILD", "IOS_RECOMMENDED_BUILD"]) {
  const value = process.env[name];
  if (value && (!/^\d+$/.test(value) || Number(value) < 0)) {
    fail(`${name} must be a non-negative integer.`);
  }
}
if (
  process.env.IOS_MINIMUM_BUILD &&
  process.env.IOS_RECOMMENDED_BUILD &&
  Number(process.env.IOS_RECOMMENDED_BUILD) < Number(process.env.IOS_MINIMUM_BUILD)
) {
  fail("IOS_RECOMMENDED_BUILD cannot be lower than IOS_MINIMUM_BUILD.");
}

if (!process.exitCode) {
  console.log("iOS release configuration is production-safe.");
}
