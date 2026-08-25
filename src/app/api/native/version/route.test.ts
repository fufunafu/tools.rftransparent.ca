import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/native/version/route";

const ORIGINAL_ENV = {
  IOS_MINIMUM_BUILD: process.env.IOS_MINIMUM_BUILD,
  IOS_RECOMMENDED_BUILD: process.env.IOS_RECOMMENDED_BUILD,
  IOS_CURRENT_VERSION: process.env.IOS_CURRENT_VERSION,
  IOS_UPDATE_URL: process.env.IOS_UPDATE_URL,
};

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("native version policy endpoint", () => {
  it("returns the configured build policy without caching it", async () => {
    process.env.IOS_MINIMUM_BUILD = "4";
    process.env.IOS_RECOMMENDED_BUILD = "6";
    process.env.IOS_CURRENT_VERSION = "1.2";
    process.env.IOS_UPDATE_URL = "https://testflight.apple.com/join/example";

    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      minimumBuild: 4,
      recommendedBuild: 6,
      currentVersion: "1.2",
      updateUrl: "https://testflight.apple.com/join/example",
    });
  });

  it("never recommends a build below the minimum or an unsafe update URL", async () => {
    process.env.IOS_MINIMUM_BUILD = "8";
    process.env.IOS_RECOMMENDED_BUILD = "7";
    process.env.IOS_UPDATE_URL = "https://example.com/download";

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      minimumBuild: 8,
      recommendedBuild: 8,
      updateUrl: null,
    });
  });

  it("falls back instead of partially parsing malformed build configuration", async () => {
    process.env.IOS_MINIMUM_BUILD = "4junk";
    process.env.IOS_RECOMMENDED_BUILD = "6.5";

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      minimumBuild: 1,
      recommendedBuild: 3,
    });
  });
});
