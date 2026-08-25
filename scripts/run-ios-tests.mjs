import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const iosRoot = resolve(root, "ios/App");
const project = resolve(iosRoot, "App.xcodeproj");
const workspaceHash = createHash("sha256").update(root).digest("hex").slice(0, 12);
const derivedDataPath = process.env.IOS_DERIVED_DATA_PATH
  ? resolve(process.env.IOS_DERIVED_DATA_PATH)
  : resolve(process.env.RUNNER_TEMP ?? tmpdir(), `rf-tools-ios-tests-${workspaceHash}`);
const operationTimeoutMs = Number(process.env.IOS_TEST_OPERATION_TIMEOUT_MS ?? 300_000);
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 30_000) {
  console.error(
    "IOS_TEST_OPERATION_TIMEOUT_MS must be an integer of at least 30000 milliseconds.",
  );
  process.exit(1);
}

if (existsSync("/opt/homebrew/bin/xcodegen") || existsSync("/usr/local/bin/xcodegen")) {
  execFileSync("xcodegen", ["generate", "--spec", "project.yml"], {
    cwd: iosRoot,
    stdio: "inherit",
  });
}

const devices = JSON.parse(
  execFileSync("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "--json"], {
    encoding: "utf8",
  }),
).devices;
const candidates = Object.entries(devices)
  .filter(([runtime]) => runtime.includes("iOS"))
  .flatMap(([runtime, entries]) => entries.map((device) => ({ ...device, runtime })))
  .filter((device) =>
    device.isAvailable && (device.name.startsWith("iPhone") || device.name.startsWith("iPad")),
  )
  .sort((left, right) => {
    const version = (runtime) => runtime.match(/iOS-(\d+)-(\d+)/)?.slice(1).map(Number) ?? [0, 0];
    const [leftMajor, leftMinor] = version(left.runtime);
    const [rightMajor, rightMinor] = version(right.runtime);
    return rightMajor - leftMajor || rightMinor - leftMinor || left.name.localeCompare(right.name);
  });

const requestedUdid = process.env.IOS_SIMULATOR_UDID;
const requestedName = process.env.IOS_TEST_DEVICE;
const requestedFamily = process.env.IOS_TEST_FAMILY?.toLowerCase();
if (requestedFamily && !["iphone", "ipad"].includes(requestedFamily)) {
  console.error(`Unsupported IOS_TEST_FAMILY: ${process.env.IOS_TEST_FAMILY}`);
  process.exit(1);
}
const selected = requestedUdid
  ? candidates.find((device) => device.udid === requestedUdid)
  : requestedName
    ? candidates.find((device) => device.name === requestedName)
    : requestedFamily === "ipad"
      ? candidates.find((device) => device.name === "iPad Pro 13-inch (M5)")
        ?? candidates.find((device) => device.name.startsWith("iPad"))
      : candidates.find((device) => device.name === "iPhone 17")
        ?? candidates.find((device) => device.name.startsWith("iPhone"))
        ?? candidates[0];
if (!selected) {
  const request = requestedUdid
    ? ` with UDID ${requestedUdid}`
    : requestedName
      ? ` named ${requestedName}`
      : requestedFamily
        ? ` in the ${requestedFamily} family`
        : "";
  console.error(`No available iPhone or iPad Simulator was found${request}.`);
  process.exit(1);
}

const scope = process.env.IOS_TEST_SCOPE ?? "all";
if (!["all", "unit", "ui"].includes(scope)) {
  console.error(`Unsupported IOS_TEST_SCOPE: ${scope}`);
  process.exit(1);
}

const requestedScopes = scope === "all" ? ["unit", "ui"] : [scope];

// Xcode 26's UI-test runner is terminated by the simulator after several
// consecutive WebKit app launches, even though the individual tests pass.
// Keep each operation below that threshold. Reusing the same DerivedData path
// means the later shards do not rebuild the app or its Swift packages.
const uiTestShards = [
  [
    "testColdLaunchCreatesBrandedNativeRootAndWebView",
    "testAppRecoversAfterBackgroundLifecycle",
    "testReturningToForegroundRequestsFreshContent",
  ],
  [
    "testPrivacyShieldCoversProtectedContentDuringLifecycleTransition",
    "testFaceIDSuccessUncoversProtectedContent",
    "testFaceIDCancellationKeepsProtectedContentCovered",
  ],
  [
    "testNativeUnlockSurfaceHasReadableOrderAndTouchSizedControl",
    "testUnavailableBiometricsShowsSetupRecovery",
    "testBiometricFallbackUsesDevicePasscode",
  ],
  [
    "testAllowedLocationShowsProgressAndOnlyServerConfirmedSuccess",
    "testDeniedLocationShowsSettingsRecoveryWithoutSuccess",
    "testRestrictedLocationShowsManagerRecoveryWithoutSuccess",
  ],
  [
    "testInaccurateLocationShowsAccuracyRecoveryWithoutSuccess",
    "testTimedOutLocationShowsRetryRecoveryWithoutSuccess",
    "testUnavailableLocationShowsServicesRecoveryWithoutSuccess",
  ],
  [
    "testExpiredSessionRequiresSecureSignInAndKeepsWorkHidden",
    "testTrustedLinksStayInAppAndExternalLinksLeaveTheWebView",
    "testUnavailableServiceShowsBundledRecoveryAndRetry",
  ],
  [
    "testOfflineColdLaunchShowsBundledRecoveryAndRetry",
    "testBundledRecoveryDistinguishesPlannedMaintenance",
  ],
];
const ipadLayoutTests = new Set([
  "testColdLaunchCreatesBrandedNativeRootAndWebView",
  "testNativeUnlockSurfaceHasReadableOrderAndTouchSizedControl",
  "testAllowedLocationShowsProgressAndOnlyServerConfirmedSuccess",
  "testOfflineColdLaunchShowsBundledRecoveryAndRetry",
]);

for (const requestedScope of requestedScopes) {
  // The iPhone gate covers every behavioral scenario. The iPad gate adds
  // representative native launch, Dynamic Type, progress, touch-target, and
  // bundled-recovery layout coverage. Browser automation separately covers
  // every authenticated workflow in iPad portrait and landscape viewports.
  // Launch one native scenario per operation because the iPad test runner has
  // a smaller memory budget than the iPhone runner.
  const deviceUIShards = selected.name.includes("iPad")
    ? uiTestShards
        .flat()
        .filter((test) => ipadLayoutTests.has(test))
        .map((test) => [test])
    : uiTestShards;
  const testShards = requestedScope === "unit"
    ? [["-only-testing:AppTests"]]
    : deviceUIShards.map((tests) => tests.map(
        (test) => `-only-testing:AppUITests/RFAppUITests/${test}`,
      ));
  const uiTestStabilityOptions = requestedScope === "unit"
    ? []
    : [
        // Xcode 26 can terminate the UI-test runner while repeatedly launching
        // a WebKit app on a busy hosted simulator. Retry that test once in the
        // same result bundle. A repeatable assertion or app failure still fails
        // the command, while a one-off runner process kill does not make CI red.
        "-retry-tests-on-failure",
        "-test-iterations", "2",
        "-parallel-testing-enabled", "NO",
      ];

  // Run hosted unit tests and UI tests as separate xcodebuild operations. When
  // both bundles start together, Xcode can reinstall the app for UI testing
  // while the hosted unit-test process is still bootstrapping, invalidating its
  // bundle path and producing an early-exit failure despite passing assertions.
  for (const [index, onlyTesting] of testShards.entries()) {
    const shard = requestedScope === "ui" ? ` shard ${index + 1}/${testShards.length}` : "";
    const action = requestedScope === "ui" && index > 0
      ? "test-without-building"
      : "test";
    console.log(
      `Running ${requestedScope} native tests${shard} on ${selected.name} (${selected.runtime}).`,
    );

    const args = [
      "-project", project,
      "-scheme", "App",
      "-configuration", "Debug",
      "-destination", `id=${selected.udid}`,
      // Keep DerivedData outside FileProvider-backed workspaces such as iCloud
      // Drive. FileProvider metadata breaks ad hoc simulator code signing, and
      // disabling signing prevents XCTest from installing a valid hosted app.
      "-derivedDataPath", derivedDataPath,
      // Index data is an editor feature and is not used by XCTest. Disabling it
      // avoids an Xcode 26 command-line deadlock while indexing Swift package
      // dependencies and makes the same runner reliable on hosted CI machines.
      "COMPILER_INDEX_STORE_ENABLE=NO",
        action,
      ...onlyTesting,
      ...uiTestStabilityOptions,
    ];
    const operationAttempts = requestedScope === "ui" ? 2 : 1;
    let status = 1;
    for (let attempt = 1; attempt <= operationAttempts; attempt += 1) {
      if (requestedScope === "ui" && selected.name.includes("iPad")) {
        // A simulator reboot releases the WebKit and accessibility services
        // that Xcode 26 otherwise leaves behind after an iPad UI-test launch.
        // The app and prebuilt test bundle remain installed.
        spawnSync("/usr/bin/xcrun", ["simctl", "shutdown", selected.udid], {
          stdio: "ignore",
        });
        const boot = spawnSync(
          "/usr/bin/xcrun",
          ["simctl", "boot", selected.udid],
          { stdio: "inherit" },
        );
        if (boot.status !== 0) process.exit(boot.status ?? 1);
        const ready = spawnSync(
          "/usr/bin/xcrun",
          ["simctl", "bootstatus", selected.udid, "-b"],
          { stdio: "inherit" },
        );
        if (ready.status !== 0) process.exit(ready.status ?? 1);
      }
      const result = spawnSync("/usr/bin/xcodebuild", args, {
        cwd: root,
        stdio: "inherit",
        // A hosted CoreSimulator process can occasionally stop responding
        // without letting xcodebuild exit. Bound every operation so CI can
        // retry the shard as a fresh Xcode process instead of hanging forever.
        timeout: operationTimeoutMs,
        killSignal: "SIGTERM",
      });
      status = result.status ?? 1;
      if (status === 0) break;
      if (result.error?.code === "ETIMEDOUT") {
        console.warn(
          `Native ${requestedScope} shard ${index + 1} exceeded ${operationTimeoutMs} ms.`,
        );
      }
      if (attempt < operationAttempts) {
        console.warn(
          `Native UI shard ${index + 1} exited with status ${status}; retrying it as a fresh Xcode operation.`,
        );
      }
    }
    if (status !== 0) {
      process.exit(status);
    }
  }
}
