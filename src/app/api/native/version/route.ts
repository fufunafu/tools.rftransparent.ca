import { NextResponse } from "next/server";
import { normalizeNativeUpdateUrl } from "@/lib/native-update";

const CURRENT_NATIVE_BUILD = 3;
const OLDEST_COMPATIBLE_NATIVE_BUILD = 1;

function buildNumber(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const android = new URL(request.url).searchParams.get("platform") === "android";
  const minimumBuild = buildNumber(
    android ? process.env.ANDROID_MINIMUM_BUILD : process.env.IOS_MINIMUM_BUILD,
    OLDEST_COMPATIBLE_NATIVE_BUILD,
  );
  const recommendedBuild = Math.max(
    minimumBuild,
    buildNumber(android ? process.env.ANDROID_RECOMMENDED_BUILD : process.env.IOS_RECOMMENDED_BUILD, android ? 1 : CURRENT_NATIVE_BUILD),
  );
  const updateUrl = normalizeNativeUpdateUrl(
    android ? process.env.ANDROID_UPDATE_URL : process.env.IOS_UPDATE_URL,
    android ? "android" : "ios",
  );

  return NextResponse.json(
    {
      minimumBuild,
      recommendedBuild,
      currentVersion: (android ? process.env.ANDROID_CURRENT_VERSION : process.env.IOS_CURRENT_VERSION) ?? "1.0",
      updateUrl,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
