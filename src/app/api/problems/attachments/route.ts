import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  isProblemPhotoId,
  matchesProblemPhotoSignature,
  MAX_PROBLEM_PHOTO_BYTES,
  PROBLEM_ATTACHMENT_BUCKET,
  PROBLEM_ATTACHMENT_COLUMNS,
  problemPhotoError,
  problemPhotoType,
} from "@/lib/problem-attachments";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (Number(req.headers.get("content-length")) > MAX_PROBLEM_PHOTO_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Each picture must be 4 MB or smaller." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the picture upload." }, { status: 400 });
  }
  const ticketId = form.get("ticket_id");
  // A stable client-generated ID makes retrying a lost response idempotent.
  const id = form.get("id");
  const file = form.get("file");
  if (!isProblemPhotoId(ticketId) || !isProblemPhotoId(id)) {
    return NextResponse.json({ error: "A valid ticket and picture ID are required." }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a picture to upload." }, { status: 400 });
  const validationError = problemPhotoError(file);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const contentType = problemPhotoType(file)!;
  if (!matchesProblemPhotoSignature(new Uint8Array(await file.slice(0, 64).arrayBuffer()), contentType)) {
    return NextResponse.json({ error: `${file.name} is not a valid supported picture.` }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: ticket, error: ticketError } = await supabase
    .from("problem_tickets").select("id").eq("id", ticketId).maybeSingle();
  if (ticketError) return NextResponse.json({ error: "Could not check the ticket. Please try again." }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: "This ticket no longer exists." }, { status: 404 });

  const { data: existing, error: existingError } = await supabase
    .from("problem_attachments").select(`${PROBLEM_ATTACHMENT_COLUMNS}, ticket_id`).eq("id", id).maybeSingle();
  if (existingError) {
    console.error("[problem photos] Could not check attachment", existingError);
    return NextResponse.json({ error: "Pictures are temporarily unavailable. Your ticket can still be saved." }, { status: 503 });
  }
  if (existing) {
    if (existing.ticket_id !== ticketId || existing.uploaded_by !== user.email) {
      return NextResponse.json({ error: "This picture ID is already in use." }, { status: 409 });
    }
    return NextResponse.json({ attachment: existing });
  }

  const path = `${ticketId}/${id}`;
  const bucket = supabase.storage.from(PROBLEM_ATTACHMENT_BUCKET);
  const { error: uploadError } = await bucket.upload(path, file, { contentType, upsert: false });
  if (uploadError) {
    console.error("[problem photos] Upload failed", uploadError);
    return NextResponse.json({ error: "Could not upload the picture. Please try again." }, { status: 500 });
  }
  const { data, error } = await supabase.from("problem_attachments").insert({
    id, ticket_id: ticketId, path,
    filename: file.name.replace(/[\r\n\0]/g, "").slice(-180) || "picture",
    content_type: contentType, size_bytes: file.size, uploaded_by: user.email,
  }).select(PROBLEM_ATTACHMENT_COLUMNS).single();
  if (error) {
    const { error: cleanupError } = await bucket.remove([path]);
    if (cleanupError) console.error("[problem photos] Orphaned upload", { path, error: cleanupError });
    console.error("[problem photos] Could not save attachment", error);
    return NextResponse.json({ error: "Could not save the picture. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ attachment: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!isProblemPhotoId(id)) return NextResponse.json({ error: "A valid picture ID is required." }, { status: 400 });

  const supabase = getSupabase();
  const { data: row, error } = await supabase.from("problem_attachments")
    .select("path, uploaded_by").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the picture." }, { status: 500 });
  if (!row) return NextResponse.json({ ok: true });
  if (row.uploaded_by !== user.email && !(await isAdminUser())) {
    return NextResponse.json({ error: "Only the uploader or an admin can remove this picture." }, { status: 403 });
  }
  // Drop access first. If object cleanup fails, the private bytes are no
  // longer addressable through the API and can be cleaned up from the log.
  const { error: deleteError } = await supabase.from("problem_attachments").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: "Could not remove the picture." }, { status: 500 });
  const { error: cleanupError } = await supabase.storage.from(PROBLEM_ATTACHMENT_BUCKET).remove([row.path]);
  if (cleanupError) console.error("[problem photos] Orphaned deleted picture", { path: row.path, error: cleanupError });
  return NextResponse.json({ ok: true });
}
