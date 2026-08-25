import { NextResponse } from "next/server";
import { normalizeNativeUpdateUrl } from "@/lib/native-update";

const CURRENT_NATIVE_BUILD = 3;
const OLDEST_COMPATIBLE_NATIVE_BUILD = 1;

function buildNumber(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET() {
  const minimumBuild = buildNumber(
    process.env.IOS_MINIMUM_BUILD,
    OLDEST_COMPATIBLE_NATIVE_BUILD,
  );
  const recommendedBuild = Math.max(
    minimumBuild,
    buildNumber(process.env.IOS_RECOMMENDED_BUILD, CURRENT_NATIVE_BUILD),
  );
  const updateUrl = normalizeNativeUpdateUrl(process.env.IOS_UPDATE_URL);

  return NextResponse.json(
    {
      minimumBuild,
      recommendedBuild,
      currentVersion: process.env.IOS_CURRENT_VERSION ?? "1.0",
      updateUrl,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
