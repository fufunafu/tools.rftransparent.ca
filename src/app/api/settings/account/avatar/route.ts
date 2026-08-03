import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  MAX_PROFILE_AVATAR_BYTES,
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_TYPES,
  avatarPathForUser,
  isProfileAvatarType,
  matchesProfileAvatarSignature,
} from "@/lib/profile-avatar";

async function ensureAvatarBucket(): Promise<void> {
  const supabase = getSupabase();
  const { error: lookupError } = await supabase.storage.getBucket(PROFILE_AVATAR_BUCKET);
  if (!lookupError) return;

  const { error: createError } = await supabase.storage.createBucket(PROFILE_AVATAR_BUCKET, {
    public: false,
    fileSizeLimit: MAX_PROFILE_AVATAR_BYTES,
    allowedMimeTypes: [...PROFILE_AVATAR_TYPES],
  });

  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    throw new Error(createError.message);
  }
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const { data, error } = await getSupabase().storage
    .from(PROFILE_AVATAR_BUCKET)
    .download(avatarPathForUser(user.id), {}, { cache: "no-store" });

  if (error || !data) return new NextResponse(null, { status: 404 });

  return new NextResponse(data, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Type": isProfileAvatarType(data.type) ? data.type : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (!isProfileAvatarType(file.type)) {
      return NextResponse.json(
        { error: "Use a JPG, PNG, or WebP image." },
        { status: 400 },
      );
    }
    if (file.size === 0 || file.size > MAX_PROFILE_AVATAR_BYTES) {
      return NextResponse.json(
        { error: "The profile photo must be smaller than 5 MB." },
        { status: 400 },
      );
    }

    const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!matchesProfileAvatarSignature(signature, file.type)) {
      return NextResponse.json(
        { error: "The selected file does not appear to be a valid image." },
        { status: 400 },
      );
    }

    await ensureAvatarBucket();
    const supabase = getSupabase();
    const path = avatarPathForUser(user.id);
    const { error: uploadError } = await supabase.storage
      .from(PROFILE_AVATAR_BUCKET)
      .upload(path, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: true,
      });
    if (uploadError) throw new Error(uploadError.message);

    const updatedAt = new Date().toISOString();
    const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        avatar_updated_at: updatedAt,
      },
    });
    if (metadataError) throw new Error(metadataError.message);

    return NextResponse.json({
      avatarUrl: `/api/settings/account/avatar?v=${encodeURIComponent(updatedAt)}`,
    });
  } catch (error) {
    console.error("[Profile avatar POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not upload the profile photo." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = getSupabase();
    const { error: removeError } = await supabase.storage
      .from(PROFILE_AVATAR_BUCKET)
      .remove([avatarPathForUser(user.id)]);
    if (removeError && !/not found/i.test(removeError.message)) {
      throw new Error(removeError.message);
    }

    const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        avatar_updated_at: null,
      },
    });
    if (metadataError) throw new Error(metadataError.message);

    return NextResponse.json({ avatarUrl: null });
  } catch (error) {
    console.error("[Profile avatar DELETE]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove the profile photo." },
      { status: 500 },
    );
  }
}
