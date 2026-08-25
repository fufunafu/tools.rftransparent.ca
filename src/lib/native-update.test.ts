import { describe, expect, it } from "vitest";
import { evaluateNativeUpdate, type NativeVersionPolicy } from "@/lib/native-update";

const policy: NativeVersionPolicy = {
  minimumBuild: 4,
  recommendedBuild: 6,
  currentVersion: "1.2",
  updateUrl: "https://testflight.apple.com/join/example",
};

describe("native update policy", () => {
  it("requires an update below the minimum build", () => {
    expect(evaluateNativeUpdate("3", policy)).toEqual({
      state: "required",
      updateUrl: policy.updateUrl,
    });
  });

  it("recommends an update between the minimum and recommended builds", () => {
    expect(evaluateNativeUpdate("5", policy)).toEqual({
      state: "recommended",
      updateUrl: policy.updateUrl,
    });
  });

  it("allows the recommended build", () => {
    expect(evaluateNativeUpdate("6", policy)).toEqual({
      state: "current",
      updateUrl: null,
    });
  });

  it("still blocks an incompatible build when the update destination is missing", () => {
    expect(evaluateNativeUpdate("1", { ...policy, updateUrl: null })).toEqual({
      state: "required",
      updateUrl: null,
    });
  });

  it.each([
    "http://apps.apple.com/app/id123",
    "https://testflight.apple.com.evil.example/join/abc",
    "https://example.com/update",
    "not a URL",
  ])("blocks an incompatible build without exposing an unsafe destination", (updateUrl) => {
    expect(evaluateNativeUpdate("1", { ...policy, updateUrl })).toEqual({
      state: "required",
      updateUrl: null,
    });
  });

  it.each(["3junk", "-1", "1.5", "", Number.NaN])(
    "does not derive an update requirement from malformed build value %s",
    (installedBuild) => {
      expect(evaluateNativeUpdate(installedBuild, policy)).toEqual({
        state: "current",
        updateUrl: null,
      });
    },
  );
});
