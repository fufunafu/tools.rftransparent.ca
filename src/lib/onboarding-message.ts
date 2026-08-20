import {
  LOGIN_METHOD_LABELS,
  type AccessStatus,
  type LoginMethod,
} from "@/lib/access-templates";

/* The onboarding message, in the three shapes it is needed in: the HTML the
   email carries, the plain text that rides alongside it, and a WhatsApp
   rendering the admin can paste by hand.

   Pure on purpose. The success screen offers "copy for email" and "copy for
   WhatsApp", and those have to produce the same words the person was sent —
   not an approximation written twice. Keeping the builders out of
   onboarding-email.ts is what lets a client component import them without
   dragging getResend and the resend package into the browser bundle.

   On passwords: these builders print them. That is the point of the message —
   the alternative in use today is a dozen loose WhatsApp lines. Nothing here
   ever reaches the database; see the onboarding route, which passes passwords
   to this module and to Supabase Auth and writes them nowhere. */

export interface OnboardingMessageRow {
  system: string;
  login_method: LoginMethod;
  account_id: string | null;
  password: string | null;
  owner_email: string | null;
  status: AccessStatus;
}

export interface OnboardingMessage {
  name: string;
  email: string;
  department: string;
  hireDate: string | null;
  toolsSignIn: "google" | "password";
  toolsPassword: string | null;
  rows: OnboardingMessageRow[];
}

export const ACCESS_PAGE_URL = "https://tools.rftransparent.ca/employees/me/access";
export const SIGN_IN_URL = "https://tools.rftransparent.ca/login";

const KEEP_THIS =
  "Keep this message. It is the only copy of these passwords — nothing here is stored in the tools application, so it cannot be looked up later.";

const NO_SELF_SERVE =
  "“Forgot your password?” only works for an account that has already signed in once, so it cannot help you get started. Ask the person named beside each system.";

/** What a Google-backed row says where a password would otherwise go. */
const GOOGLE_LINE = "Sign in with your company Google account";

function usernameFor(row: OnboardingMessageRow, fallback: string): string {
  return row.account_id?.trim() || fallback;
}

function displayText(value: string | null | undefined, maxLength = 200): string {
  const clean = value?.trim();
  if (!clean) return "Not provided";
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char]!,
  );
}

export function buildOnboardingText(message: OnboardingMessage): string {
  const lines = [
    `Welcome${message.name ? `, ${message.name}` : ""}.`,
    "",
    `Department: ${displayText(message.department)}`,
    `Start date: ${displayText(message.hireDate)}`,
    "",
    "GETTING INTO RF TOOLS",
  ];

  if (message.toolsSignIn === "google") {
    lines.push(GOOGLE_LINE + ". There is no password to set up.");
  } else {
    lines.push(`Username: ${message.email}`);
    lines.push(`Password: ${message.toolsPassword ?? "Ask your manager"}`);
  }
  lines.push(`Sign in: ${SIGN_IN_URL}`, "", NO_SELF_SERVE, "", "YOUR ACCOUNTS");

  if (message.rows.length === 0) {
    lines.push("Nothing is set up yet. Your manager will follow up.");
  } else {
    for (const row of message.rows) {
      lines.push("", row.system);
      lines.push(`  Sign-in: ${LOGIN_METHOD_LABELS[row.login_method]}`);
      if (row.login_method === "google_sso") {
        lines.push(`  ${GOOGLE_LINE}`);
      } else {
        lines.push(`  Username: ${usernameFor(row, message.email)}`);
        if (row.password?.trim()) lines.push(`  Password: ${row.password.trim()}`);
      }
      lines.push(`  Ask: ${displayText(row.owner_email)}`);
    }
  }

  lines.push("", KEEP_THIS, "", `Your access list: ${ACCESS_PAGE_URL}`);
  return lines.join("\n");
}

/** WhatsApp has no tables, so this is line by line, with its own bold marks. */
export function buildOnboardingWhatsApp(message: OnboardingMessage): string {
  const lines = [`*Welcome${message.name ? `, ${message.name}` : ""}*`, ""];

  lines.push(
    `Everything set up for you in ${displayText(message.department)}${
      message.hireDate ? `, starting ${message.hireDate}` : ""
    }.`,
    "",
    "*Getting into RF Tools*",
  );

  if (message.toolsSignIn === "google") {
    lines.push(`${GOOGLE_LINE}. No password needed.`);
  } else {
    lines.push(`Username: ${message.email}`);
    lines.push(`Password: ${message.toolsPassword ?? "Ask your manager"}`);
  }
  lines.push(SIGN_IN_URL, "", "*Your accounts*");

  if (message.rows.length === 0) {
    lines.push("", "Nothing is set up yet. Your manager will follow up.");
  } else {
    for (const row of message.rows) {
      lines.push("", `*${row.system}*`);
      if (row.login_method === "google_sso") {
        lines.push(GOOGLE_LINE);
      } else {
        lines.push(`Username: ${usernameFor(row, message.email)}`);
        if (row.password?.trim()) lines.push(`Password: ${row.password.trim()}`);
      }
      lines.push(`Ask: ${displayText(row.owner_email)}`);
    }
  }

  lines.push("", KEEP_THIS, "", `Your access list: ${ACCESS_PAGE_URL}`);
  return lines.join("\n");
}

export function buildOnboardingHtml(message: OnboardingMessage): string {
  const bootstrap =
    message.toolsSignIn === "google"
      ? `<p style="margin:0">${escapeHtml(GOOGLE_LINE)}. There is no password to set up.</p>`
      : `<table style="border-collapse:collapse;font-size:14px"><tbody>
           <tr><td style="padding:3px 14px 3px 0;color:#64748b">Username</td><td style="padding:3px 0">${escapeHtml(message.email)}</td></tr>
           <tr><td style="padding:3px 14px 3px 0;color:#64748b">Password</td><td style="padding:3px 0"><code style="background:#eef2ff;border-radius:4px;padding:2px 6px">${escapeHtml(message.toolsPassword ?? "Ask your manager")}</code></td></tr>
         </tbody></table>`;

  const rows =
    message.rows.length === 0
      ? `<tr><td colspan="4" style="padding:10px 0;color:#64748b">Nothing is set up yet. Your manager will follow up.</td></tr>`
      : message.rows
          .map((row) => {
            const secret =
              row.login_method === "google_sso"
                ? `<span style="color:#2563eb">${escapeHtml(GOOGLE_LINE)}</span>`
                : row.password?.trim()
                  ? `<code style="background:#eef2ff;border-radius:4px;padding:2px 6px">${escapeHtml(row.password.trim())}</code>`
                  : `<span style="color:#94a3b8">Ask below</span>`;
            return `<tr style="border-top:1px solid #e2e8f0">
      <td style="padding:9px 16px 9px 0;font-weight:600;vertical-align:top">${escapeHtml(row.system)}</td>
      <td style="padding:9px 16px 9px 0;vertical-align:top">${escapeHtml(LOGIN_METHOD_LABELS[row.login_method])}</td>
      <td style="padding:9px 16px 9px 0;color:#334155;vertical-align:top">${
        row.login_method === "google_sso" ? "" : escapeHtml(usernameFor(row, message.email))
      }</td>
      <td style="padding:9px 16px 9px 0;vertical-align:top">${secret}</td>
      <td style="padding:9px 0;color:#64748b;vertical-align:top">${escapeHtml(displayText(row.owner_email))}</td>
    </tr>`;
          })
          .join("");

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#0f172a">
    <h2 style="margin:0 0 16px">Welcome${message.name ? `, ${escapeHtml(message.name)}` : ""}</h2>
    <p style="margin:0 0 18px;color:#475569">
      Here is everything set up for you in ${escapeHtml(displayText(message.department))}${
        message.hireDate ? `, starting ${escapeHtml(message.hireDate)}` : ""
      }.
    </p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:0 0 20px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Getting into RF Tools</div>
      ${bootstrap}
      <p style="margin:10px 0 0;color:#64748b;font-size:13px">${escapeHtml(NO_SELF_SERVE)}</p>
    </div>

    <div style="font-size:13px;color:#64748b;margin-bottom:6px">Your accounts</div>
    <table style="border-collapse:collapse;font-size:14px;width:100%">
      <thead><tr style="text-align:left;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em">
        <th style="padding:0 16px 6px 0">System</th>
        <th style="padding:0 16px 6px 0">Sign-in</th>
        <th style="padding:0 16px 6px 0">Username</th>
        <th style="padding:0 16px 6px 0">Password</th>
        <th style="padding:0 0 6px 0">Ask</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="margin:18px 0 0;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e">
      ${escapeHtml(KEEP_THIS)}
    </p>

    <p style="margin:22px 0 0">
      <a href="${ACCESS_PAGE_URL}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">See your access list</a>
    </p>
    <p style="margin:14px 0 0;color:#94a3b8;font-size:11px">
      Signing in: <a href="${SIGN_IN_URL}" style="color:#2563eb">${SIGN_IN_URL}</a>
    </p>
  </div>`;
}
