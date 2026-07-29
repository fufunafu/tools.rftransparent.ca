import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { BUG_BUCKET } from "@/lib/bug-reports";

export const dynamic = "force-dynamic";

/**
 * Content-Disposition for a user-supplied filename.
 *
 * Header values are ByteStrings (latin-1), so any non-ASCII character throws
 * "Cannot convert argument to a ByteString" and the whole response 500s. This
 * is not an edge case: every macOS screenshot is named "Screenshot ... at
 * 2.54.04 PM.png" with U+202F (narrow no-break space) before the AM/PM, so
 * the most common attachment there is breaks the naive version.
 *
 * RFC 6266: a plain ASCII `filename` for old clients, plus `filename*` with
 * the real UTF-8 name percent-encoded.
 */
function contentDisposition(filename: string | null): string {
  const name = filename ?? "screenshot";
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

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
      "Content-Disposition": contentDisposition(row.filename),
    },
  });
}
