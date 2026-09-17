import { NextRequest, NextResponse } from "next/server";
import { fieldSalesAttributionInputSchema } from "@/lib/field-sales";
import { getFieldSalesActor } from "@/lib/field-sales-access";
import type { FieldSalesQuoteCandidate } from "@/lib/field-sales-types";
import { getSupabase } from "@/lib/supabase";

interface LeadSearchRow {
  id: string;
  draft_name: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  quote_amount: number | string | null;
  shopify_created_at: string | null;
  lead_status: string;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function managerActor() {
  const actor = await getFieldSalesActor();
  if (!actor) return { error: json({ error: "Unauthorized" }, 401) } as const;
  if (!actor.canManage) return { error: json({ error: "Forbidden" }, 403) } as const;
  return { actor } as const;
}

export async function GET(request: NextRequest) {
  const access = await managerActor();
  if ("error" in access) return access.error;
  const search = (request.nextUrl.searchParams.get("q") ?? "").trim().toLocaleLowerCase("en-CA");
  if (search.length < 2) return json({ quotes: [] });

  const supabase = getSupabase();
  const leads = await supabase
    .from("followup_leads")
    .select("id, draft_name, customer_name, customer_email, customer_phone, quote_amount, shopify_created_at, lead_status")
    .order("shopify_created_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (leads.error) {
    console.error("Failed to search field sales quote candidates", leads.error);
    return json({ error: "Shopify quotes could not be searched." }, 503);
  }
  const quoteRows = (leads.data ?? []) as LeadSearchRow[];
  const matches = quoteRows
    .filter((lead) => [lead.draft_name, lead.customer_name, lead.customer_email, lead.customer_phone]
      .some((value) => value?.toLocaleLowerCase("en-CA").includes(search)))
    .slice(0, 40);
  const links = matches.length
    ? await supabase.from("field_sales_revenue_links").select("lead_id, visit_id").in("lead_id", matches.map((lead) => lead.id))
    : { data: [], error: null };
  if (links.error) {
    console.error("Failed to load existing field sales quote links", links.error);
    return json({ error: "Shopify quotes could not be searched." }, 503);
  }
  const linkedVisitByLead = new Map(
    (links.data ?? []).map((link) => [String(link.lead_id), String(link.visit_id)]),
  );
  const quotes: FieldSalesQuoteCandidate[] = matches
    .map((lead) => ({
      id: lead.id,
      draftName: lead.draft_name,
      customerName: lead.customer_name,
      customerEmail: lead.customer_email,
      customerPhone: lead.customer_phone,
      quoteAmount: Number(lead.quote_amount) || 0,
      quotedAt: lead.shopify_created_at,
      leadStatus: lead.lead_status,
      linkedVisitId: linkedVisitByLead.get(lead.id) ?? null,
    }));
  return json({ quotes });
}

export async function POST(request: NextRequest) {
  const access = await managerActor();
  if ("error" in access) return access.error;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const parsed = fieldSalesAttributionInputSchema.safeParse(input);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid quote link." }, 400);
  }

  const supabase = getSupabase();
  const [visit, lead] = await Promise.all([
    supabase
      .from("field_sales_visits")
      .select("id, account_id, employee_id, status")
      .eq("id", parsed.data.visitId)
      .maybeSingle(),
    supabase.from("followup_leads").select("id").eq("id", parsed.data.leadId).maybeSingle(),
  ]);
  if (visit.error || lead.error) return json({ error: "The visit or quote could not be verified." }, 503);
  if (!visit.data || visit.data.status !== "completed") return json({ error: "Choose a completed visit." }, 404);
  if (!lead.data) return json({ error: "Shopify quote not found." }, 404);

  const result = await supabase.from("field_sales_revenue_links").insert({
    visit_id: visit.data.id,
    account_id: visit.data.account_id,
    employee_id: visit.data.employee_id,
    lead_id: lead.data.id,
    link_source: "manual",
    linked_by_email: access.actor.email,
  }).select("id").single();
  if (result.error?.code === "23505") return json({ error: "That quote is already linked to a field visit." }, 409);
  if (result.error) {
    console.error("Failed to link Shopify quote to field visit", result.error);
    return json({ error: "The quote could not be linked." }, 503);
  }
  return json({ ok: true, linkId: result.data.id }, 201);
}

export async function DELETE(request: NextRequest) {
  const access = await managerActor();
  if ("error" in access) return access.error;
  const linkId = request.nextUrl.searchParams.get("linkId");
  if (!linkId) return json({ error: "Link ID is required." }, 400);
  const result = await getSupabase()
    .from("field_sales_revenue_links")
    .delete()
    .eq("id", linkId)
    .select("id")
    .maybeSingle();
  if (result.error) return json({ error: "The quote link could not be removed." }, 503);
  if (!result.data) return json({ error: "Quote link not found." }, 404);
  return json({ ok: true });
}
