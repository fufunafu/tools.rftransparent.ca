import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { isMissingColumn, BUG_BUCKET } from "@/lib/bug-reports";

// The back-and-forth on one bug. Anyone signed in can read and add; only an
// admin can remove a comment (and only ever their own mistakes — deleting
// someone else's answer would lose the reason a bug was closed).

export async function GET(req: NextRequest) {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bugId = req.nextUrl.searchParams.get("bug_id");
  if (!bugId) return NextResponse.json({ error: "bug_id is required" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("bug_comments")
    .select("id, bug_id, author, body, created_at")
    .eq("bug_id", bugId)
    .order("created_at", { ascending: true });

  if (error?.code === "PGRST205") return NextResponse.json({ comments: [] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const comments = data ?? [];
  const ids = comments.map((c) => c.id);

  // Images posted with a comment. Before migration 064 there's no comment_id
  // column, so every comment simply has none.
  const byComment = new Map<string, unknown[]>();
  if (ids.length) {
    const { data: attachments, error: attachError } = await getSupabase()
      .from("bug_attachments")
      .select("id, comment_id, filename, content_type, size_bytes, created_at")
      .in("comment_id", ids)
      .order("created_at", { ascending: true });

    if (attachError && !isMissingColumn(attachError)) {
      return NextResponse.json({ error: attachError.message }, { status: 500 });
    }
    for (const a of attachments ?? []) {
      const list = byComment.get(a.comment_id) ?? [];
      list.push({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type,
        size_bytes: a.size_bytes,
        created_at: a.created_at,
      });
      byComment.set(a.comment_id, list);
    }
  }

  return NextResponse.json({
    comments: comments.map((c) => ({ ...c, attachments: byComment.get(c.id) ?? [] })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const bugId = typeof body.bug_id === "string" ? body.bug_id : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!bugId) return NextResponse.json({ error: "bug_id is required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Say something first" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("bug_comments")
    .insert({ bug_id: bugId, author: user.email, body: text.slice(0, 5000) })
    .select("id, bug_id, author, body, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();

  // The attachment ROWS cascade with the comment, but the stored objects
  // don't — drop them first or the bucket keeps paying for images nothing
  // points at. Same reasoning as deleting a whole report.
  const { data: attachments, error: lookupError } = await supabase
    .from("bug_attachments")
    .select("path")
    .eq("comment_id", id);

  // Before migration 064 there's no comment_id column and so no objects to
  // clean up; that isn't a reason to refuse the delete.
  if (lookupError && !isMissingColumn(lookupError)) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  const paths = (attachments ?? []).map((a) => a.path);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(BUG_BUCKET).remove(paths);
    // Orphaned bytes aren't worth failing the delete over — the comment is
    // what the user asked to remove.
    if (storageError) console.warn(`[bugs] could not remove objects: ${storageError.message}`);
  }

  const { error } = await supabase.from("bug_comments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
