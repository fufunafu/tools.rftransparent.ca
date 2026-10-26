import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Always use the manifest next to THIS script, including when checking a
// separate release checkout. An older candidate must not supply the baseline.
const baselineRoot = fileURLToPath(new URL("../", import.meta.url));
const candidateRoot = resolve(process.argv[2] ?? baselineRoot);
try {
  const manifest = JSON.parse(readFileSync(resolve(baselineRoot, "docs/sales-preservation-baseline.json"), "utf8"));
  const entries = Object.entries(manifest.sourceHashes ?? {});
  if (!entries.length) throw new Error("The sales preservation manifest is empty.");
  const failures = [];
  for (const [path, expected] of entries) {
    if (!path.startsWith("src/") || path.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`Invalid preservation entry: ${path}`);
    }
    try {
      const actual = createHash("sha256").update(readFileSync(resolve(candidateRoot, path))).digest("hex");
      if (actual !== expected) failures.push(`Changed: ${path}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      failures.push(`Missing: ${path}`);
    }
  }
  if (failures.length) {
    console.error("Sales preservation check failed. Release requires review:");
    failures.forEach((failure) => console.error(`  ${failure}`));
    console.error("Reconcile these files with the preserved sales version. See docs/release-preservation.md. Do not refresh hashes just to bypass this check.");
    process.exitCode = 1;
  } else {
    console.log(`Sales preservation check passed: ${entries.length} files match the preserved source.`);
  }
} catch (error) {
  console.error(`Sales preservation check failed: ${error.message}`);
  process.exitCode = 1;
}
