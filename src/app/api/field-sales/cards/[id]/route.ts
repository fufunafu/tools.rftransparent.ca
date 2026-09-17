import { NextRequest, NextResponse } from "next/server";
import { FIELD_SALES_CARD_BUCKET } from "@/lib/field-sales";
import { getFieldSalesActor } from "@/lib/field-sales-access";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function contentDisposition(filename: string | null): string {
  const name = filename ?? "business-card";
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getFieldSalesActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabase();
  const result = await supabase
    .from("field_sales_contacts")
    .select("employee_id, card_path, card_filename, card_content_type")
    .eq("id", id)
    .maybeSingle();
  if (result.error || !result.data?.card_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!actor.canManage && result.data.employee_id !== actor.employee?.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const download = await supabase.storage
    .from(FIELD_SALES_CARD_BUCKET)
    .download(result.data.card_path);
  if (download.error || !download.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(download.data, {
    headers: {
      "Content-Type": result.data.card_content_type ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": contentDisposition(result.data.card_filename),
    },
  });
}
