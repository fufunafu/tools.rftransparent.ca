const PRODUCTION_ORIGIN = "https://tools.rftransparent.ca";
const APP_ID = "94BK7NCPL9.ca.rftransparent.tools";
const REQUIRED_PATHS = new Set([
  "/",
  "/clock",
  "/todos",
  "/more",
  "/warehouse/report",
  "/customer-service",
  "/customer-service/follow-up",
  "/customer-service/problems",
  "/sales",
  "/dashboards/marketing",
  "/employees",
  "/warehouse",
  "/support",
  "/privacy",
]);
const APPLE_UPDATE_HOSTS = new Set([
  "apps.apple.com",
  "itunes.apple.com",
  "testflight.apple.com",
]);

const origin = (process.env.IOS_DEPLOYMENT_ORIGIN ?? PRODUCTION_ORIGIN).replace(/\/$/, "");
const failures = [];

function fail(message) {
  failures.push(message);
}

async function get(path) {
  try {
    return await fetch(`${origin}${path}`, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    fail(`${path} could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function json(response, path) {
  try {
    return await response.json();
  } catch {
    fail(`${path} did not return valid JSON.`);
    return null;
  }
}

function hasNoStore(response) {
  return /(?:^|,)\s*(?:private,\s*)?no-store(?:,|$)/i.test(
    response.headers.get("cache-control") ?? "",
  );
}

const associationPaths = [
  "/.well-known/apple-app-site-association",
  "/apple-app-site-association",
];
const associations = [];
for (const path of associationPaths) {
  const response = await get(path);
  if (!response) continue;
  if (response.status !== 200) {
    fail(`${path} returned ${response.status}; Apple requires a direct 200 response.`);
    continue;
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    fail(`${path} is not served as application/json.`);
  }
  const payload = await json(response, path);
  if (payload) associations.push({ path, payload });
}

for (const { path, payload } of associations) {
  const details = payload?.applinks?.details;
  const appIDs = Array.isArray(details)
    ? details.flatMap((detail) => Array.isArray(detail?.appIDs) ? detail.appIDs : [])
    : [];
  if (!appIDs.includes(APP_ID)) fail(`${path} does not include ${APP_ID}.`);

  const paths = new Set(
    Array.isArray(details)
      ? details.flatMap((detail) =>
          Array.isArray(detail?.components)
            ? detail.components.map((component) => component?.["/"]).filter((value) => typeof value === "string")
            : [],
        )
      : [],
  );
  for (const required of REQUIRED_PATHS) {
    if (!paths.has(required)) fail(`${path} is missing the supported path ${required}.`);
  }
}
if (
  associations.length === 2 &&
  JSON.stringify(associations[0].payload) !== JSON.stringify(associations[1].payload)
) {
  fail("The root and well-known association payloads differ.");
}

const versionPath = "/api/native/version";
const versionResponse = await get(versionPath);
if (versionResponse) {
  if (versionResponse.status !== 200) fail(`${versionPath} returned ${versionResponse.status}.`);
  if (!hasNoStore(versionResponse)) fail(`${versionPath} must use Cache-Control: no-store.`);
  if (versionResponse.status === 200) {
    const policy = await json(versionResponse, versionPath);
    if (policy) {
      if (!Number.isInteger(policy.minimumBuild) || policy.minimumBuild < 0) {
        fail("The deployed minimumBuild is not a non-negative integer.");
      }
      if (!Number.isInteger(policy.recommendedBuild) || policy.recommendedBuild < policy.minimumBuild) {
        fail("The deployed recommendedBuild is invalid or below minimumBuild.");
      }
      if (typeof policy.currentVersion !== "string" || !/^\d+\.\d+(?:\.\d+)?$/.test(policy.currentVersion)) {
        fail("The deployed currentVersion is not a valid app version.");
      }
      try {
        const updateURL = new URL(policy.updateUrl);
        if (updateURL.protocol !== "https:" || !APPLE_UPDATE_HOSTS.has(updateURL.hostname.toLowerCase())) {
          fail("The deployed updateUrl is not an approved HTTPS Apple destination.");
        }
      } catch {
        fail("The deployed updateUrl is missing or invalid.");
      }
    }
  }
}

const statusPath = "/api/native/status";
const statusResponse = await get(statusPath);
if (statusResponse) {
  if (statusResponse.status !== 200) fail(`${statusPath} returned ${statusResponse.status}.`);
  if (!hasNoStore(statusResponse)) fail(`${statusPath} must use Cache-Control: no-store.`);
  if (statusResponse.status === 200) {
    const service = await json(statusResponse, statusPath);
    if (service && service.state !== "operational" && service.state !== "maintenance") {
      fail("The deployed native service state is invalid.");
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`iOS deployment verification failed: ${failure}`);
  process.exit(1);
}

console.log(`iOS deployment verification passed for ${origin}.`);
