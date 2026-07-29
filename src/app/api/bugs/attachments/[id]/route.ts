import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { BUG_BUCKET } from "@/lib/bug-reports";

export const dynamic = "force-dynamic";

// Serves one screenshot. The bucket is private, so rather than handing the
// page a signed URL (which then leaks if pasted anywhere), the bytes come
// back through here behind the same session check as every other route —
// `<img src="/api/bugs/attachments/<id>">` just works.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthenticatedUser()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabase();

  const { data: row, error } = await supabase
    .from("bug_attachments")
    .select("path, filename, content_type")
    .eq("id", id)
    .single();
  if (error || !row)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUG_BUCKET)
    .download(row.path);
  if (downloadError || !blob)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(blob, {
    headers: {
      "Content-Type": row.content_type ?? "application/octet-stream",
      // Screenshots never change once uploaded, and the id is unguessable.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${(row.filename ?? "screenshot").replace(/"/g, "")}"`,
    },
  });
}
