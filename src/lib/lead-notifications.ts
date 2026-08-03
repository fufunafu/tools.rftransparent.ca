import { getResend } from "@/lib/resend";

const FROM = "RF Transparent <info@glass-railing.com>";
export const LEAD_NOTIFICATION_RECIPIENT = "info@glass-railing.com";
const LEADS_DASHBOARD_URL = "https://tools.rftransparent.ca/customer-service/leads";

export interface NewLeadNotification {
  leadId: string;
  source: "website" | "meta";
  sourceDetail: string | null;
  pageUrl: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
}

/**
 * Best-effort notification for a lead that is already safely stored.
 * Email delivery must never turn a successful webhook into a retry.
 */
export async function sendNewLeadNotification(
  lead: NewLeadNotification,
): Promise<boolean> {
  const sourceLabel = lead.source === "meta" ? "Meta" : "website";
  const subjectName = cleanHeaderText(lead.name);
  const subject = `New ${sourceLabel} lead${subjectName ? `: ${subjectName}` : ""}`;

  try {
    const { error } = await getResend().emails.send({
      from: FROM,
      to: LEAD_NOTIFICATION_RECIPIENT,
      subject,
      text: buildText(lead, sourceLabel),
      html: buildHtml(lead, sourceLabel),
    });

    if (error) {
      console.error("[lead-notification] Resend rejected the email:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[lead-notification] email send failed:", error);
    return false;
  }
}

function buildText(lead: NewLeadNotification, sourceLabel: string): string {
  return [
    `New ${sourceLabel} lead`,
    "",
    `Name: ${displayText(lead.name)}`,
    `Email: ${displayText(lead.email)}`,
    `Phone: ${displayText(lead.phone)}`,
    `Source: ${displayText(lead.sourceDetail)}`,
    `Page: ${displayText(lead.pageUrl)}`,
    "",
    "Message:",
    displayText(lead.message),
    "",
    `Open lead dashboard: ${LEADS_DASHBOARD_URL}`,
    `Lead ID: ${lead.leadId}`,
  ].join("\n");
}

function buildHtml(lead: NewLeadNotification, sourceLabel: string): string {
  const rows = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Source", lead.sourceDetail],
    ["Page", lead.pageUrl],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:5px 16px 5px 0;color:#64748b;vertical-align:top">${label}</td><td style="padding:5px 0">${escapeHtml(displayText(value))}</td></tr>`,
    )
    .join("");

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#0f172a">
    <h2 style="margin:0 0 16px">New ${sourceLabel} lead</h2>
    <table style="border-collapse:collapse;font-size:14px"><tbody>${rows}</tbody></table>
    <div style="margin-top:18px">
      <div style="font-size:13px;color:#64748b;margin-bottom:5px">Message</div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;white-space:pre-wrap">${escapeHtml(displayText(lead.message))}</div>
    </div>
    <p style="margin:20px 0 0">
      <a href="${LEADS_DASHBOARD_URL}" style="color:#2563eb">Open lead dashboard</a>
    </p>
    <p style="margin:12px 0 0;color:#94a3b8;font-size:11px">Lead ID: ${escapeHtml(lead.leadId)}</p>
  </div>`;
}

function displayText(value: string | null, maxLength = 5000): string {
  const clean = value?.trim();
  if (!clean) return "Not provided";
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

function cleanHeaderText(value: string | null): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}
