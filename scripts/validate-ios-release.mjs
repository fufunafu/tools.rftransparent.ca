import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const productionUrl = "https://tools.rftransparent.ca";
const capBinary = resolve(projectRoot, "node_modules/.bin/cap");

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

const evaluatedResult = evaluateConfig();
const evaluated = evaluatedResult.app?.extConfig;
const embeddedPath = resolve(projectRoot, "ios/App/App/capacitor.config.json");
const embedded = JSON.parse(readFileSync(embeddedPath, "utf8"));
const infoPlist = readFileSync(resolve(projectRoot, "ios/App/App/Info.plist"), "utf8");

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
