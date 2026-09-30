import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const config = JSON.parse(read("android/app/src/main/assets/capacitor.config.json"));
assert.equal(config.appId, "ca.rftransparent.tools");
assert.equal(config.server?.url, "https://tools.rftransparent.ca");
assert.equal(config.server?.cleartext, false);
assert.deepEqual(config.server?.allowNavigation, []);
assert.equal(config.server?.errorPath, "offline.html");
assert.equal(config.android?.allowMixedContent, false);
assert.equal(config.android?.webContentsDebuggingEnabled, false);
const manifest = read("android/app/src/main/AndroidManifest.xml");
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(manifest, /android.permission.ACCESS_FINE_LOCATION/);
assert.doesNotMatch(manifest, /ACCESS_BACKGROUND_LOCATION|READ_CONTACTS|READ_SMS|MANAGE_EXTERNAL_STORAGE/);
assert.match(read("android/app/src/main/java/ca/rftransparent/tools/MainActivity.java"), /registerPlugin\(RFNativeSupportPlugin.class\)/);
assert.match(read("android/variables.gradle"), /targetSdkVersion = 36/);
assert.match(read("android/app/src/main/assets/public/offline.html"), /retryRemoteLoad/);
const plugins = JSON.parse(read("android/app/src/main/assets/capacitor.plugins.json"));
for (const name of ["@capacitor/app", "@capacitor/geolocation", "@aparajita/capacitor-biometric-auth"]) {
  assert(plugins.some((plugin) => plugin.pkg === name), `Missing native plugin: ${name}`);
}
console.log("Android production configuration passed: HTTPS, foreground location, native unlock, and bundled recovery.");
