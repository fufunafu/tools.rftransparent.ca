import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getResend } from "@/lib/resend";
import { formatCAD } from "@/lib/format";

export const dynamic = "force-dynamic";

const FROM = "RF Tools <noreply@rftransparent.ca>";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const idNum = parseInt(id, 10);
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json();
  const { status, rejection_reason } = body as {
    status?: "approved" | "rejected";
    rejection_reason?: string;
  };
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 });
  }
  if (status === "rejected" && !rejection_reason?.trim()) {
    return NextResponse.json({ error: "rejection_reason required when rejecting" }, { status: 400 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("expense_reimbursements")
    .update({
      status,
      rejection_reason: status === "rejected" ? rejection_reason!.trim() : null,
      reviewed_at: now,
      reviewed_by_email: user.email.toLowerCase(),
      updated_at: now,
    })
    .eq("id", idNum)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  // Notify the submitter.
  try {
    const resend = getResend();
    const subject = `Reimbursement #${data.id} ${status}`;
    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 8px">Your reimbursement was ${status}</h2>
        <p style="margin:0 0 16px;color:#475569">
          Request <strong>#${data.id}</strong> — ${data.vendor} — ${formatCAD(Number(data.amount))}
        </p>
        ${
          status === "rejected"
            ? `<p style="margin:0 0 16px"><strong>Reason:</strong> ${(data.rejection_reason ?? "").replace(/\n/g, "<br>")}</p>`
            : `<p style="margin:0 0 16px;color:#16a34a">Approved — finance will follow up with payment details.</p>`
        }
        <p style="margin:0;color:#475569;font-size:13px">
          You can view your requests at <a href="https://tools.rftransparent.ca/accounting/reimbursement">tools.rftransparent.ca/accounting/reimbursement</a>.
        </p>
      </div>
    `;
    await resend.emails.send({
      from: FROM,
      to: data.submitted_by_email,
      subject,
      html,
    });
  } catch (err) {
    console.error("[reimbursement] status email failed:", err);
  }

  return NextResponse.json({ request: data });
}
