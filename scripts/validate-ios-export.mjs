import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const exportDirectory = process.argv[2] ? resolve(process.argv[2]) : null;
const archivePath = process.argv[3] ? resolve(process.argv[3]) : null;
const expectedBundleIdentifier = "ca.rftransparent.tools";
const expectedTeamIdentifier = "94BK7NCPL9";
const expectedProductionUrl = "https://tools.rftransparent.ca";

function fail(message) {
  console.error(`iOS export validation failed: ${message}`);
  process.exitCode = 1;
}

function stop(message) {
  fail(message);
  process.exit();
}

function parsePlist(path) {
  const output = execFileSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", "--", path],
    { encoding: "utf8" },
  );
  return JSON.parse(output);
}

function parsePlistBuffer(buffer) {
  const output = execFileSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", "--", "-"],
    { encoding: "utf8", input: buffer },
  );
  return JSON.parse(output);
}

function plistValue(path, key) {
  return execFileSync(
    "/usr/bin/plutil",
    ["-extract", key, "raw", "-o", "-", "--", path],
    { encoding: "utf8" },
  ).trim();
}

function readZipEntry(ipaPath, entry) {
  return execFileSync("/usr/bin/unzip", ["-p", ipaPath, entry]);
}

function entitlementBlock(output, key) {
  const marker = `[Key] ${key}`;
  const start = output.indexOf(marker);
  if (start === -1) return "";
  const next = output.indexOf("[Key] ", start + marker.length);
  return output.slice(start, next === -1 ? undefined : next);
}

if (!exportDirectory || !existsSync(exportDirectory)) {
  stop("provide the existing export directory as the first argument.");
}
if (!archivePath || !existsSync(archivePath)) {
  stop("provide the matching .xcarchive as the second argument.");
}

const ipaNames = readdirSync(exportDirectory).filter((name) => name.endsWith(".ipa"));
if (ipaNames.length !== 1) {
  stop(`expected exactly one IPA in ${exportDirectory}; found ${ipaNames.length}.`);
}

const ipaName = ipaNames[0];
const ipaPath = join(exportDirectory, ipaName);
const entryNames = execFileSync("/usr/bin/unzip", ["-Z1", ipaPath], {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);
const appRoots = new Set(
  entryNames
    .map((entry) => entry.match(/^(Payload\/[^/]+\.app)(?:\/|$)/)?.[1])
    .filter(Boolean),
);
if (appRoots.size !== 1) {
  stop(`expected exactly one app bundle in ${ipaName}; found ${appRoots.size}.`);
}

const appRoot = [...appRoots][0];
const info = parsePlistBuffer(readZipEntry(ipaPath, `${appRoot}/Info.plist`));
const capacitorConfig = JSON.parse(
  readZipEntry(ipaPath, `${appRoot}/capacitor.config.json`).toString("utf8"),
);
const distributionSummaryPath = join(exportDirectory, "DistributionSummary.plist");
if (!existsSync(distributionSummaryPath)) {
  stop("the export is missing DistributionSummary.plist.");
}
const distributionSummary = parsePlist(distributionSummaryPath);
const distributionEntries = distributionSummary[ipaName] ?? [];
if (distributionEntries.length !== 1) {
  stop(`expected one distribution summary entry for ${ipaName}.`);
}
const distribution = distributionEntries[0];
const archiveInfoPath = join(archivePath, "Info.plist");
const archiveApplication = {
  CFBundleIdentifier: plistValue(archiveInfoPath, "ApplicationProperties.CFBundleIdentifier"),
  CFBundleShortVersionString: plistValue(archiveInfoPath, "ApplicationProperties.CFBundleShortVersionString"),
  CFBundleVersion: plistValue(archiveInfoPath, "ApplicationProperties.CFBundleVersion"),
};

for (const [label, actual, expected] of [
  ["bundle identifier", info.CFBundleIdentifier, expectedBundleIdentifier],
  ["archive bundle identifier", archiveApplication.CFBundleIdentifier, expectedBundleIdentifier],
  ["distribution team", distribution.team?.id, expectedTeamIdentifier],
  ["app version", info.CFBundleShortVersionString, archiveApplication.CFBundleShortVersionString],
  ["app build", info.CFBundleVersion, archiveApplication.CFBundleVersion],
  ["distribution version", distribution.versionNumber, archiveApplication.CFBundleShortVersionString],
  ["distribution build", distribution.buildNumber, archiveApplication.CFBundleVersion],
]) {
  if (`${actual ?? ""}` !== `${expected ?? ""}`) {
    fail(`${label} is ${actual ?? "missing"}; expected ${expected ?? "missing"}.`);
  }
}

if (!/Apple Distribution/.test(distribution.certificate?.type ?? "")) {
  fail("the IPA is not signed with an Apple Distribution certificate.");
}
if (!/Store Provisioning Profile/.test(distribution.profile?.name ?? "")) {
  fail("the IPA does not use an App Store provisioning profile.");
}

const entitlements = distribution.entitlements ?? {};
if (entitlements["aps-environment"] !== "production") {
  fail("the IPA is missing the production APNs entitlement.");
}
if (
  JSON.stringify(entitlements["com.apple.developer.associated-domains"] ?? []) !==
  JSON.stringify(["applinks:tools.rftransparent.ca"])
) {
  fail("the IPA has an unexpected Associated Domains entitlement.");
}
if (entitlements["beta-reports-active"] !== true) {
  fail("the IPA is missing beta-reports-active.");
}
if (entitlements["get-task-allow"] !== false) {
  fail("the IPA allows debugger attachment.");
}
if (entitlements["application-identifier"] !== `${expectedTeamIdentifier}.${expectedBundleIdentifier}`) {
  fail("the IPA has an unexpected application identifier.");
}

if (capacitorConfig.server?.url !== expectedProductionUrl) {
  fail(`the IPA must load ${expectedProductionUrl}.`);
}
if (capacitorConfig.server?.cleartext === true) {
  fail("the IPA enables cleartext traffic.");
}
if ((capacitorConfig.server?.allowNavigation ?? []).length !== 0) {
  fail("the IPA allows additional in-WebView navigation hosts.");
}
if (capacitorConfig.server?.errorPath !== "offline.html") {
  fail("the IPA is missing the bundled offline recovery path.");
}
if (capacitorConfig.ios?.webContentsDebuggingEnabled === true) {
  fail("the IPA enables production WebView debugging.");
}
if (/localhost|127\.0\.0\.1/i.test(JSON.stringify(capacitorConfig))) {
  fail("the IPA contains a local development host.");
}

const extractionRoot = mkdtempSync(join(tmpdir(), "rf-tools-ios-export-check-"));
try {
  execFileSync("/usr/bin/unzip", ["-q", ipaPath, "-d", extractionRoot]);
  const appPath = join(extractionRoot, appRoot);
  const codesign = spawnSync(
    "/usr/bin/codesign",
    ["-d", "--entitlements", "-", appPath],
    { encoding: "utf8" },
  );
  if (codesign.status !== 0) {
    fail(`codesign could not read the exported app entitlements: ${(codesign.stderr || codesign.stdout).trim()}`);
  } else {
    const output = `${codesign.stdout}\n${codesign.stderr}`;
    if (!entitlementBlock(output, "aps-environment").includes("[String] production")) {
      fail("the signed app entitlement blob is missing production APNs.");
    }
    if (!entitlementBlock(output, "com.apple.developer.associated-domains").includes("applinks:tools.rftransparent.ca")) {
      fail("the signed app entitlement blob is missing Associated Domains.");
    }
    if (!entitlementBlock(output, "beta-reports-active").includes("[Bool] true")) {
      fail("the signed app entitlement blob is missing beta-reports-active.");
    }
    if (!entitlementBlock(output, "get-task-allow").includes("[Bool] false")) {
      fail("the signed app entitlement blob allows debugger attachment.");
    }
  }
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`iOS App Store export is production-safe: ${ipaPath}`);
}
