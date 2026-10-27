import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import type {
  CustomerServiceQueueState,
  QueueAction,
  QueueItemType,
} from "@/lib/customer-service-queue";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import { quotePostgrestValue } from "@/lib/postgrest";
import { getSupabase } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "private, no-store" };

async function actor() {
  const user = await getAuthenticatedUser();
  if (!user?.email) return null;
  const employee = await findActiveEmployeeByEmail(user.email);
  if (!employee || employee.department !== "customer_service") return null;
  return { email: user.email.toLowerCase(), employee };
}

export async function GET() {
  const current = await actor();
  if (!current) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  try {
    const assignment = `assigned_to.eq.${quotePostgrestValue(current.email)},assigned_to.is.null`;
    const supabase = getSupabase();
    const [callbacks, followups] = await Promise.all([
      supabase
        .from("callback_notes")
        .select("store_id, from_number, note, status, assigned_to, updated_at")
        .or(assignment)
        .neq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("followup_leads")
        .select("id, customer_name, customer_phone, draft_name, quote_amount, lead_status, next_followup_at, assigned_to")
        .or(assignment)
        .is("closed_at", null)
        .not("shopify_status", "in", "(OPEN,DELETED)")
        .order("next_followup_at", { ascending: true, nullsFirst: false })
        .limit(100),
    ]);
    if (callbacks.error) throw new Error(callbacks.error.message);
    if (followups.error) throw new Error(followups.error.message);

    const response: CustomerServiceQueueState = {
      callbacks: callbacks.data ?? [],
      followups: followups.data ?? [],
    };
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to load customer-service queue", error);
    return NextResponse.json(
      { error: "Your customer-service queue is temporarily unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function POST(req: NextRequest) {
  const current = await actor();
  if (!current) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  let body: {
    type?: QueueItemType;
    action?: QueueAction;
    id?: string;
    storeId?: string;
    phone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: NO_STORE });
  }
  if (!(["callback", "followup"] as const).includes(body.type as QueueItemType) ||
      !(["claim", "release"] as const).includes(body.action as QueueAction)) {
    return NextResponse.json({ error: "Invalid queue action" }, { status: 400, headers: NO_STORE });
  }

  const supabase = getSupabase();
  if (body.type === "followup") {
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400, headers: NO_STORE });
    let query = supabase
      .from("followup_leads")
      .update({ assigned_to: body.action === "claim" ? current.email : null })
      .eq("id", body.id);
    query = body.action === "claim"
      ? query.is("assigned_to", null)
      : query.eq("assigned_to", current.email);
    const result = await query.select("assigned_to").maybeSingle();
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500, headers: NO_STORE });
    }
    if (!result.data) {
      return NextResponse.json(
        { error: body.action === "claim" ? "Someone else already claimed this work." : "This work is not assigned to you." },
        { status: 409, headers: NO_STORE },
      );
    }
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  }

  if (!body.storeId || !body.phone) {
    return NextResponse.json({ error: "storeId and phone are required" }, { status: 400, headers: NO_STORE });
  }
  if (body.action === "release") {
    const result = await supabase
      .from("callback_notes")
      .update({ assigned_to: null, updated_at: new Date().toISOString() })
      .eq("store_id", body.storeId)
      .eq("from_number", body.phone)
      .eq("assigned_to", current.email)
      .select("assigned_to")
      .maybeSingle();
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500, headers: NO_STORE });
    }
    if (!result.data) {
      return NextResponse.json({ error: "This work is not assigned to you." }, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  }

  const existing = await supabase
    .from("callback_notes")
    .update({ assigned_to: current.email, updated_at: new Date().toISOString() })
    .eq("store_id", body.storeId)
    .eq("from_number", body.phone)
    .is("assigned_to", null)
    .select("assigned_to")
    .maybeSingle();
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500, headers: NO_STORE });
  }
  if (existing.data) return NextResponse.json({ success: true }, { headers: NO_STORE });

  const inserted = await supabase
    .from("callback_notes")
    .insert({
      store_id: body.storeId,
      from_number: body.phone,
      note: "",
      status: "pending",
      assigned_to: current.email,
      updated_at: new Date().toISOString(),
    })
    .select("assigned_to")
    .maybeSingle();
  if (inserted.error?.code === "23505") {
    return NextResponse.json(
      { error: "Someone else already claimed this work." },
      { status: 409, headers: NO_STORE },
    );
  }
  if (inserted.error) {
    return NextResponse.json({ error: inserted.error.message }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ success: true }, { headers: NO_STORE });
}
