export interface NativeVersionPolicy {
  minimumBuild: number;
  recommendedBuild: number;
  currentVersion: string;
  updateUrl: string | null;
}

export type NativeUpdateDecision =
  | { state: "current"; updateUrl: null }
  | { state: "recommended"; updateUrl: string }
  | { state: "required"; updateUrl: string | null };

const APPLE_UPDATE_HOSTS = new Set([
  "apps.apple.com",
  "itunes.apple.com",
  "testflight.apple.com",
]);

export function normalizeNativeUpdateUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && APPLE_UPDATE_HOSTS.has(url.hostname.toLowerCase())
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function parseBuild(value: string | number): number | null {
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const build = typeof value === "number" ? value : Number(value);
  return Number.isInteger(build) && build >= 0 ? build : null;
}

export function evaluateNativeUpdate(
  installedBuild: string | number,
  policy: NativeVersionPolicy,
): NativeUpdateDecision {
  const installed = parseBuild(installedBuild);
  const minimum = parseBuild(policy.minimumBuild);
  const recommended = parseBuild(policy.recommendedBuild);
  const validUpdateUrl = normalizeNativeUpdateUrl(policy.updateUrl);

  if (installed === null || minimum === null || recommended === null) {
    return { state: "current", updateUrl: null };
  }
  // Compatibility enforcement must not fail open because the deployment is
  // temporarily missing its store destination. The blocking UI can still
  // direct the employee to support while operations fixes IOS_UPDATE_URL.
  if (installed < minimum) {
    return { state: "required", updateUrl: validUpdateUrl };
  }
  if (installed < recommended && validUpdateUrl) {
    return { state: "recommended", updateUrl: validUpdateUrl };
  }
  return { state: "current", updateUrl: null };
}

export async function checkNativeUpdate(
  installedBuild: string,
  signal?: AbortSignal,
): Promise<NativeUpdateDecision> {
  const response = await fetch("/api/native/version", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Native version policy is unavailable.");
  const policy = (await response.json()) as NativeVersionPolicy;
  return evaluateNativeUpdate(installedBuild, policy);
}
