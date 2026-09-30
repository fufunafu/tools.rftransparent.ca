import { getNativePlatform, type NativePlatform } from "@/lib/native-platform";

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

export function normalizeNativeUpdateUrl(value: string | null | undefined, platform: NativePlatform = "ios"): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const trustedHost = platform === "android"
      ? url.hostname === "play.google.com" && url.pathname === "/store/apps/details" && url.searchParams.get("id") === "ca.rftransparent.tools"
      : APPLE_UPDATE_HOSTS.has(url.hostname.toLowerCase());
    return url.protocol === "https:" && !url.username && !url.password && !url.port && trustedHost
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
  platform: NativePlatform = "ios",
): NativeUpdateDecision {
  const installed = parseBuild(installedBuild);
  const minimum = parseBuild(policy.minimumBuild);
  const recommended = parseBuild(policy.recommendedBuild);
  const validUpdateUrl = normalizeNativeUpdateUrl(policy.updateUrl, platform);

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
  const platform = getNativePlatform();
  const response = await fetch(`/api/native/version?platform=${platform}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Native version policy is unavailable.");
  const policy = (await response.json()) as NativeVersionPolicy;
  return evaluateNativeUpdate(installedBuild, policy, platform);
}
