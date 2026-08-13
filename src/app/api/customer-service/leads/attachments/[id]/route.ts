import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  attachmentContentDisposition,
  attachmentResponseDisposition,
  LEAD_ATTACHMENT_BUCKET,
} from "@/lib/customer-service/lead-attachments";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthenticatedUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabase();
  const { data: attachment, error } = await supabase
    .from("lead_attachments")
    .select("path, filename, content_type")
    .eq("id", id)
    .single();

  if (error || !attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: file, error: downloadError } = await supabase
    .storage
    .from(LEAD_ATTACHMENT_BUCKET)
    .download(attachment.path);

  if (downloadError || !file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shouldDownload = req.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(file, {
    headers: {
      "Content-Type": attachment.content_type || "application/octet-stream",
      "Content-Disposition": attachmentContentDisposition(
        attachment.filename,
        attachmentResponseDisposition(
          attachment.filename,
          attachment.content_type,
          shouldDownload,
        ),
      ),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
