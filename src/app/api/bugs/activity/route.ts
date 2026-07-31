import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { isMissingTable, isMissingColumn, type BugActivityEvent } from "@/lib/bug-reports";

// Recent activity across every report, merged from what already happened
// rather than from an events table: a report's created_at, a comment's
// created_at, and repaired_at. Nothing to backfill and no migration — the
// history is already implicit in the rows.
//
// The gap that leaves is deliberate and worth knowing: status changes other
// than "repaired" aren't recorded anywhere, and even repaired_at doesn't say
// WHO set it. Naming an actor there would mean an events table.

const LIMIT = 25;

export async function GET() {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();

  const { data: bugs, error } = await supabase
    .from("bug_reports")
    .select("id, title, reported_by, created_at, repaired_at, status")
    .order("created_at", { ascending: false })
    .limit(200);

  if (isMissingTable(error)) return NextResponse.json({ events: [] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const titles = new Map((bugs ?? []).map((b) => [b.id, b.title]));
  const ids = [...titles.keys()];
  if (!ids.length) return NextResponse.json({ events: [] });

  const [commentsRes, attachmentsRes] = await Promise.all([
    supabase
      .from("bug_comments")
      .select("id, bug_id, author, created_at")
      .in("bug_id", ids)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("bug_attachments")
      .select("id, bug_id, comment_id")
      .in("bug_id", ids),
  ]);

  // Count images per comment and per report so an event can say "with 2
  // images" instead of emitting a separate, noisier event for each upload.
  const byComment = new Map<string, number>();
  const byReport = new Map<string, number>();
  if (!attachmentsRes.error || isMissingColumn(attachmentsRes.error)) {
    for (const a of attachmentsRes.data ?? []) {
      if (a.comment_id) byComment.set(a.comment_id, (byComment.get(a.comment_id) ?? 0) + 1);
      else byReport.set(a.bug_id, (byReport.get(a.bug_id) ?? 0) + 1);
    }
  }

  const events: BugActivityEvent[] = [];

  for (const b of bugs ?? []) {
    events.push({
      id: `reported:${b.id}`,
      kind: "reported",
      at: b.created_at,
      actor: b.reported_by,
      bug_id: b.id,
      bug_title: b.title,
      images: byReport.get(b.id) ?? 0,
    });
    // repaired_at is the only status transition with a timestamp on it.
    if (b.repaired_at) {
      events.push({
        id: `repaired:${b.id}`,
        kind: "repaired",
        at: b.repaired_at,
        actor: null,
        bug_id: b.id,
        bug_title: b.title,
        images: 0,
      });
    }
  }

  for (const c of commentsRes.data ?? []) {
    events.push({
      id: `comment:${c.id}`,
      kind: "commented",
      at: c.created_at,
      actor: c.author,
      bug_id: c.bug_id,
      bug_title: titles.get(c.bug_id) ?? "a report",
      images: byComment.get(c.id) ?? 0,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return NextResponse.json({ events: events.slice(0, LIMIT) });
}
