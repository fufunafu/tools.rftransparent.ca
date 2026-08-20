import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const storageState = process.env.E2E_MOBILE_STORAGE_STATE || process.env.E2E_STORAGE_STATE;

function fail(message) {
  console.error(`Mobile E2E preflight failed: ${message}`);
  process.exit(1);
}

if (!storageState) {
  fail(
    "set E2E_MOBILE_STORAGE_STATE to a non-production warehouse employee Playwright storage-state file. Use npm run test:e2e:mobile:public for signed-out checks only.",
  );
}

const storagePath = resolve(storageState);
if (!existsSync(storagePath)) {
  fail(`storage-state file does not exist: ${storagePath}`);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(storagePath, "utf8"));
} catch {
  fail(`storage-state file is not valid JSON: ${storagePath}`);
}

if (!Array.isArray(parsed?.cookies) || parsed.cookies.length === 0) {
  fail("storage-state file does not contain an authenticated browser cookie.");
}

if (process.env.E2E_MOBILE_DEPARTMENT !== "warehouse") {
  fail(
    "set E2E_MOBILE_DEPARTMENT=warehouse and use a warehouse employee account so identity-binding coverage executes.",
  );
}

console.log("Mobile E2E authenticated preflight passed.");
