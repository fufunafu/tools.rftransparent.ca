export const PROFILE_AVATAR_BUCKET = "profile-avatars";
export const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024;
export const PROFILE_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function avatarPathForUser(userId: string): string {
  return `${userId}/profile-photo`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getProfileAvatarUrl(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const updatedAt = metadata.avatar_updated_at;
  if (typeof updatedAt === "string" && updatedAt.trim()) {
    return `/api/settings/account/avatar?v=${encodeURIComponent(updatedAt)}`;
  }
  // No uploaded photo — fall back to the Google account picture that OAuth
  // sign-in stores in the metadata, so people get a face without uploading.
  const picture = metadata.picture ?? metadata.avatar_url;
  if (typeof picture === "string" && picture.startsWith("https://")) return picture;
  return null;
}

export function isProfileAvatarType(value: string): value is (typeof PROFILE_AVATAR_TYPES)[number] {
  return PROFILE_AVATAR_TYPES.includes(value as (typeof PROFILE_AVATAR_TYPES)[number]);
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function matchesProfileAvatarSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/png") {
    return hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === "image/jpeg") {
    return hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);
  }
  if (contentType === "image/webp") {
    return hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
  }
  return false;
}

