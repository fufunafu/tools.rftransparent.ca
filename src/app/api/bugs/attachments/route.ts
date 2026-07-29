import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  BUG_BUCKET,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_TYPES,
} from "@/lib/bug-reports";

// Screenshot upload. The browser posts the file here rather than straight to
// Supabase Storage: the bucket is private and only the server holds the
// service-role key, so nothing about the storage layer is exposed to the page.

/** Strip anything that could escape the bug's folder or confuse a header. */
function safeName(name: string): string {
  return (
    name
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(-80) || "screenshot"
  );
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const bugId = form.get("bug_id");
  const file = form.get("file");

  if (typeof bugId !== "string" || !bugId)
    return NextResponse.json({ error: "bug_id is required" }, { status: 400 });
  if (!(file instanceof File))
    return NextResponse.json({ error: "No file received" }, { status: 400 });

  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type))
    return NextResponse.json(
      { error: `${file.name} isn't an image we can store (PNG, JPEG, GIF or WebP).` },
      { status: 400 }
    );
  if (file.size > MAX_ATTACHMENT_BYTES)
    return NextResponse.json(
      { error: `${file.name} is over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB.` },
      { status: 400 }
    );

  const supabase = getSupabase();

  // Path is scoped by bug so deleting a report can drop the whole folder, and
  // prefixed with a uuid so two "Screenshot.png" uploads don't collide.
  const path = `${bugId}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUG_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    // The bucket is created by hand like a migration; say so plainly rather
    // than surfacing "Bucket not found" to someone reporting a bug.
    const missingBucket = /bucket/i.test(uploadError.message);
    return NextResponse.json(
      {
        error: missingBucket
          ? `Screenshot storage isn't set up yet — create the private "${BUG_BUCKET}" bucket in Supabase.`
          : uploadError.message,
      },
      { status: missingBucket ? 503 : 500 }
    );
  }

  const { data, error } = await supabase
    .from("bug_attachments")
    .insert({
      bug_id: bugId,
      path,
      filename: file.name.slice(-120),
      content_type: file.type,
      size_bytes: file.size,
      uploaded_by: user.email,
    })
    .select("id, filename, content_type, size_bytes, created_at")
    .single();

  if (error) {
    // Don't leave bytes behind that no row points at.
    await supabase.storage.from(BUG_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attachment: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: row, error: fetchError } = await supabase
    .from("bug_attachments")
    .select("path")
    .eq("id", id)
    .single();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 404 });

  await supabase.storage.from(BUG_BUCKET).remove([row.path]);
  const { error } = await supabase.from("bug_attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
