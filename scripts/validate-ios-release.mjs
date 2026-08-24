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
const projectFile = readFileSync(resolve(projectRoot, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
const privacyManifestPath = resolve(projectRoot, "ios/App/App/PrivacyInfo.xcprivacy");
const privacyManifest = parsePlist(privacyManifestPath);
const metadata = readFileSync(resolve(projectRoot, "app-store-assets/submission-metadata.md"), "utf8");

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
  ["Version", "1.0"],
  ["Build", "3"],
  ["Support URL", "https://tools.rftransparent.ca/support"],
  ["Marketing URL", "https://rftransparent.ca/"],
]) {
  if (metadataValue(metadata, label) !== expected) {
    fail(`App Store metadata ${label} must be ${expected}.`);
  }
}

for (const expected of [
  "MARKETING_VERSION = 1.0;",
  "CURRENT_PROJECT_VERSION = 3;",
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

if ((privacyManifest.NSPrivacyAccessedAPITypes ?? []).length !== 0) {
  fail("review app-owned required-reason API declarations before release.");
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
  "KeyboardPlugin",
  "CAPNetworkPlugin",
  "SecureStorage",
  "SplashScreenPlugin",
  "StatusBarPlugin",
];
const registered = new Set(embedded.packageClassList ?? []);
for (const plugin of requiredPlugins) {
  if (!registered.has(plugin)) fail(`embedded iOS config is missing ${plugin}.`);
}

if (!process.exitCode) {
  console.log("iOS release configuration is production-safe.");
}
