import { describe, expect, it } from "vitest";
import {
  avatarPathForUser,
  getProfileAvatarUrl,
  isProfileAvatarType,
  matchesProfileAvatarSignature,
} from "@/lib/profile-avatar";

describe("profile avatar", () => {
  it("builds a user-scoped storage path", () => {
    expect(avatarPathForUser("user-123")).toBe("user-123/profile-photo");
  });

  it("builds a cache-busted private URL from metadata", () => {
    expect(getProfileAvatarUrl({ avatar_updated_at: "2026-08-03T16:30:00.000Z" })).toBe(
      "/api/settings/account/avatar?v=2026-08-03T16%3A30%3A00.000Z",
    );
    expect(getProfileAvatarUrl({ avatar_updated_at: null })).toBeNull();
  });

  it("accepts only supported browser image types", () => {
    expect(isProfileAvatarType("image/jpeg")).toBe(true);
    expect(isProfileAvatarType("image/svg+xml")).toBe(false);
  });

  it("checks image signatures instead of trusting the content type", () => {
    expect(
      matchesProfileAvatarSignature(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe(true);
    expect(
      matchesProfileAvatarSignature(
        new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e, 0, 0, 0, 0, 0, 0, 0]),
        "image/png",
      ),
    ).toBe(false);
    expect(
      matchesProfileAvatarSignature(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        "image/webp",
      ),
    ).toBe(true);
  });
});

