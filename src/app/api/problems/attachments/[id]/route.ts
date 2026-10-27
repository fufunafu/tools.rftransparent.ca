import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { attachmentContentDisposition } from "@/lib/customer-service/lead-attachments";
import { canPreviewProblemPhoto, isProblemPhotoId, PROBLEM_ATTACHMENT_BUCKET } from "@/lib/problem-attachments";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAuthenticatedUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isProblemPhotoId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = getSupabase();
  const { data: row, error } = await supabase.from("problem_attachments")
    .select("path, filename, content_type").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the picture." }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: file, error: downloadError } = await supabase.storage.from(PROBLEM_ATTACHMENT_BUCKET).download(row.path);
  if (downloadError || !file) return NextResponse.json({ error: "Picture unavailable" }, { status: 404 });
  const download = req.nextUrl.searchParams.get("download") === "1" || !canPreviewProblemPhoto(row.content_type);
  return new NextResponse(file, { headers: {
    "Content-Type": row.content_type,
    "Content-Disposition": attachmentContentDisposition(row.filename, download ? "attachment" : "inline"),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
