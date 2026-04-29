import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";

const FINANCE_EMAIL = "finance@glass-railing.com";
const FROM = "RF Tools <noreply@rftransparent.ca>";

export interface ExpenseReimbursement {
  id: number;
  submitted_by_email: string;
  employee_id: string | null;
  expense_date: string;
  amount: number;
  vendor: string;
  category: string;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  submitted_at: string;
  updated_at: string;
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") ?? "mine";
  const supabase = getSupabase();

  let q = supabase
    .from("expense_reimbursements")
    .select("*")
    .order("submitted_at", { ascending: false });

  if (scope === "all") {
    if (!(await isManagementUser())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    q = q.eq("submitted_by_email", user.email.toLowerCase());
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { expense_date, amount, vendor, category, description } = body as {
    expense_date?: string;
    amount?: number;
    vendor?: string;
    category?: string;
    description?: string | null;
  };

  if (!expense_date || !amount || !vendor || !category) {
    return NextResponse.json(
      { error: "expense_date, amount, vendor and category are required" },
      { status: 400 },
    );
  }
  if (Number(amount) <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  const submitterEmail = user.email.toLowerCase();
  const supabase = getSupabase();

  // Best-effort employee link by email — soft FK, OK if absent.
  let employeeId: string | null = null;
  try {
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("email", submitterEmail)
      .maybeSingle();
    employeeId = (emp?.id as string | undefined) ?? null;
  } catch {
    // employees.email may not exist yet
  }

  const { data, error } = await supabase
    .from("expense_reimbursements")
    .insert({
      submitted_by_email: submitterEmail,
      employee_id: employeeId,
      expense_date,
      amount,
      vendor,
      category,
      description: description ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  const row = data as ExpenseReimbursement;

  // Notify finance + CC the submitter. Receipt photo is sent separately by
  // the submitter to FINANCE_EMAIL (the email below reminds them).
  try {
    const resend = getResend();
    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 8px">Reimbursement #${row.id}</h2>
        <p style="margin:0 0 16px;color:#475569">
          Submitted by <strong>${submitterEmail}</strong>
        </p>
        <table style="border-collapse:collapse;font-size:14px">
          <tbody>
            <tr><td style="padding:4px 12px 4px 0;color:#64748b">Date</td><td>${row.expense_date}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vendor</td><td>${row.vendor}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#64748b">Category</td><td>${row.category}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount</td><td><strong>${formatAmount(Number(row.amount))}</strong></td></tr>
            ${row.description ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top">Description</td><td>${row.description.replace(/\n/g, "<br>")}</td></tr>` : ""}
          </tbody>
        </table>
        <p style="margin:16px 0 0;color:#475569;font-size:13px">
          The receipt photo will be forwarded separately by the submitter.
        </p>
      </div>
    `;
    await resend.emails.send({
      from: FROM,
      to: FINANCE_EMAIL,
      cc: submitterEmail,
      subject: `Reimbursement #${row.id} — ${row.vendor} — ${formatAmount(Number(row.amount))}`,
      html,
    });
  } catch (err) {
    // Log but don't fail the submission — the row is already in the DB.
    console.error("[reimbursement] email send failed:", err);
  }

  return NextResponse.json({ request: row }, { status: 201 });
}
