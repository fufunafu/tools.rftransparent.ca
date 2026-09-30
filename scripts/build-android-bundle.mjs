import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const required = ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length || !existsSync(process.env.ANDROID_KEYSTORE_PATH ?? "")) {
  console.error("A release upload key is required. Configure ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD privately. No unsigned store bundle was produced.");
  process.exit(1);
}
const result = spawnSync("./gradlew", ["bundleRelease", "--no-daemon"], {
  cwd: resolve(import.meta.dirname, "../android"),
  env: process.env,
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
