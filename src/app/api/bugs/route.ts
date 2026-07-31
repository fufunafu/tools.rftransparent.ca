import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  isBugType,
  isBugStatus,
  BUG_BUCKET,
  isMissingTable,
  isMissingColumn,
} from "@/lib/bug-reports";

const COLUMNS =
  "id, system_id, title, type, status, description, steps, reported_by, created_at, updated_at, repaired_at";

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}


export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bug_reports")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    // PostgREST caps a response at 1000 rows silently, so asking for more just
    // hides the truncation. Page with .range() if this table ever grows past it.
    .limit(1000);

  // The page renders a "run the migration" note instead of an error screen.
  if (isMissingTable(error))
    return NextResponse.json({ bugs: [], systems: [], tableMissing: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bugs = data ?? [];
  const ids = bugs.map((b) => b.id);

  const ATTACHMENT_COLUMNS = "id, bug_id, filename, content_type, size_bytes, created_at";

  // Only the images filed with the report itself — ones tied to a comment
  // render inside that comment. Falls back to the unfiltered query when
  // migration 064 hasn't been applied, where every attachment is report-level
  // anyway.
  const reportAttachments = async () => {
    if (!ids.length) return { data: [], error: null };
    const filtered = await supabase
      .from("bug_attachments")
      .select(ATTACHMENT_COLUMNS)
      .in("bug_id", ids)
      .is("comment_id", null)
      .order("created_at", { ascending: true });
    if (!isMissingColumn(filtered.error)) return filtered;
    return supabase
      .from("bug_attachments")
      .select(ATTACHMENT_COLUMNS)
      .in("bug_id", ids)
      .order("created_at", { ascending: true });
  };

  // Attachments and comment counts in two queries rather than one per bug.
  const [attachmentsRes, commentsRes, systemsRes] = await Promise.all([
    reportAttachments(),
    ids.length
      ? supabase.from("bug_comments").select("bug_id").in("bug_id", ids)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("bug_systems").select("id, name").order("name"),
  ]);

  const byBug = new Map<string, unknown[]>();
  for (const a of attachmentsRes.data ?? []) {
    const list = byBug.get(a.bug_id) ?? [];
    list.push({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size_bytes: a.size_bytes,
      created_at: a.created_at,
    });
    byBug.set(a.bug_id, list);
  }

  const commentCounts = new Map<string, number>();
  for (const c of commentsRes.data ?? []) {
    commentCounts.set(c.bug_id, (commentCounts.get(c.bug_id) ?? 0) + 1);
  }

  return NextResponse.json({
    bugs: bugs.map((b) => ({
      ...b,
      attachments: byBug.get(b.id) ?? [],
      comment_count: commentCounts.get(b.id) ?? 0,
    })),
    systems: systemsRes.data ?? [],
    tableMissing: false,
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title)
    return NextResponse.json({ error: "A short summary is required" }, { status: 400 });

  const systemId = typeof body.system_id === "string" ? body.system_id : "";
  if (!systemId)
    return NextResponse.json({ error: "Pick which system this is in" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("bug_reports")
    .insert({
      system_id: systemId,
      title,
      type: isBugType(body.type) ? body.type : "other",
      description: optionalText(body.description),
      steps: optionalText(body.steps),
      reported_by: user.email,
    })
    .select(COLUMNS)
    .single();

  if (isMissingTable(error))
    return NextResponse.json(
      { error: "Bug reports aren't set up yet — migration 063 hasn't been applied." },
      { status: 503 }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bug: { ...data, attachments: [], comment_count: 0 } });
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: current, error: fetchError } = await supabase
    .from("bug_reports")
    .select("status, reported_by")
    .eq("id", id)
    .single();
  if (fetchError)
    return NextResponse.json({ error: fetchError.message }, { status: 404 });

  const admin = await isAdminUser();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Anyone can flesh out a report (usually their own, answering a question).
  if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
  if (typeof body.system_id === "string" && body.system_id) updates.system_id = body.system_id;
  if (isBugType(body.type)) updates.type = body.type;
  if ("description" in body) updates.description = optionalText(body.description);
  if ("steps" in body) updates.steps = optionalText(body.steps);

  // Status is the call on whether something is actually fixed, so it's the
  // one field reserved for admins.
  if ("status" in body) {
    if (!admin)
      return NextResponse.json(
        { error: "Only an admin can change a bug's status." },
        { status: 403 }
      );
    if (!isBugStatus(body.status))
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });

    updates.status = body.status;
    if (body.status === "repaired" && current.status !== "repaired") {
      updates.repaired_at = new Date().toISOString();
    } else if (body.status !== "repaired") {
      updates.repaired_at = null;
    }
  }

  const { data, error } = await supabase
    .from("bug_reports")
    .update(updates)
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bug: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();

  // Comment and attachment ROWS cascade, but the stored objects don't — drop
  // them first or the bucket keeps paying for screenshots nothing points at.
  const { data: attachments } = await supabase
    .from("bug_attachments")
    .select("path")
    .eq("bug_id", id);
  const paths = (attachments ?? []).map((a) => a.path);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(BUG_BUCKET).remove(paths);
    // Orphaned bytes are not worth failing the delete over — the row is the
    // thing the user asked to remove.
    if (storageError) console.warn(`[bugs] could not remove objects: ${storageError.message}`);
  }

  const { error } = await supabase.from("bug_reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
