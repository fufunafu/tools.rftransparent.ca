import { NextRequest, NextResponse } from "next/server";
import {
  contactInputSchema,
  FIELD_SALES_CARD_BUCKET,
  FIELD_SALES_CARD_TYPES,
  FIELD_SALES_MAX_CARD_BYTES,
  safeStorageName,
} from "@/lib/field-sales";
import { getFieldSalesActor } from "@/lib/field-sales-access";
import { getSupabase } from "@/lib/supabase";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest) {
  const actor = await getFieldSalesActor();
  if (!actor) return json({ error: "Unauthorized" }, 401);
  if (!actor.employee || !actor.canUsePersonalWorkspace) {
    return json({ error: "An active sales profile is required." }, 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid form data." }, 400);
  }

  const parsed = contactInputSchema.safeParse({
    accountId: text(form, "accountId"),
    visitId: text(form, "visitId"),
    name: text(form, "name"),
    jobTitle: text(form, "jobTitle"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    notes: text(form, "notes"),
  });
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid contact." }, 400);

  const fileValue = form.get("card");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (file && !FIELD_SALES_CARD_TYPES.includes(file.type as (typeof FIELD_SALES_CARD_TYPES)[number])) {
    return json({ error: "Business cards must be PNG, JPEG, WebP, HEIC, or HEIF images." }, 400);
  }
  if (file && file.size > FIELD_SALES_MAX_CARD_BYTES) {
    return json({ error: "The business-card image must be 10 MB or smaller." }, 400);
  }

  const supabase = getSupabase();
  let path: string | null = null;
  try {
    const account = await supabase
      .from("field_sales_accounts")
      .select("id")
      .eq("id", parsed.data.accountId)
      .maybeSingle();
    if (account.error) throw new Error(account.error.message);
    if (!account.data) return json({ error: "Customer site not found." }, 404);

    if (parsed.data.visitId) {
      const visit = await supabase
        .from("field_sales_visits")
        .select("id")
        .eq("id", parsed.data.visitId)
        .eq("employee_id", actor.employee.id)
        .eq("account_id", parsed.data.accountId)
        .maybeSingle();
      if (visit.error) throw new Error(visit.error.message);
      if (!visit.data) return json({ error: "Visit not found." }, 404);
    }

    if (file) {
      path = `${actor.employee.id}/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
      const upload = await supabase.storage
        .from(FIELD_SALES_CARD_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) throw new Error(upload.error.message);
    }

    const result = await supabase
      .from("field_sales_contacts")
      .insert({
        employee_id: actor.employee.id,
        account_id: parsed.data.accountId,
        visit_id: parsed.data.visitId || null,
        name: parsed.data.name,
        job_title: parsed.data.jobTitle || null,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        notes: parsed.data.notes || null,
        card_path: path,
        card_filename: file?.name.slice(-160) ?? null,
        card_content_type: file?.type ?? null,
        card_size_bytes: file?.size ?? null,
      })
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return json({ ok: true, contactId: result.data.id }, 201);
  } catch (error) {
    if (path) await supabase.storage.from(FIELD_SALES_CARD_BUCKET).remove([path]);
    console.error("Failed to save field sales contact", error);
    return json({ error: "The contact could not be saved." }, 503);
  }
}
