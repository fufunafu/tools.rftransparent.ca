// What each department is given on day one.
//
// In code rather than in a table on purpose: this is a policy the team argues
// about in review, not data anyone edits at runtime. A template is only ever a
// starting point — the onboarding form fills the rows in and every one of them
// stays editable before it is saved, so an exception never needs a migration.
//
// OWNER ADDRESSES ARE PLACEHOLDERS. Every row currently points at the general
// company inbox because the real owner of each system has not been decided.
// They are written as one constant rather than repeated, so naming the actual
// people is a single edit here and nothing else in the codebase has to change.

export type LoginMethod =
  | "google_sso"
  | "microsoft_sso"
  | "password"
  | "magic_link"
  | "none";

export type AccessStatus = "not_requested" | "requested" | "active" | "revoked";

export interface AccessTemplateRow {
  system: string;
  login_method: LoginMethod;
  owner_email: string;
}

export const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  google_sso: "Google sign-in",
  microsoft_sso: "Microsoft sign-in",
  password: "Password",
  magic_link: "Email link",
  none: "No sign-in",
};

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  not_requested: "Not requested",
  requested: "Requested",
  active: "Active",
  revoked: "Revoked",
};

// Everyone gets the tools account; it is what the welcome email is about, and
// it is the row whose login_method decides how the person gets in at all.
const PLACEHOLDER_OWNER = "info@glass-railing.com";

const RF_TOOLS: AccessTemplateRow = {
  system: "RF Tools",
  login_method: "google_sso",
  owner_email: PLACEHOLDER_OWNER,
};

const GOOGLE_WORKSPACE: AccessTemplateRow = {
  system: "Google Workspace",
  login_method: "google_sso",
  owner_email: PLACEHOLDER_OWNER,
};

export const DEPARTMENT_ACCESS: Record<string, AccessTemplateRow[]> = {
  marketing: [
    RF_TOOLS,
    GOOGLE_WORKSPACE,
    { system: "Image library", login_method: "password", owner_email: PLACEHOLDER_OWNER },
    { system: "Google Ads", login_method: "google_sso", owner_email: PLACEHOLDER_OWNER },
    { system: "Google Analytics", login_method: "google_sso", owner_email: PLACEHOLDER_OWNER },
    { system: "Meta Business Suite", login_method: "none", owner_email: PLACEHOLDER_OWNER },
  ],
  // Customer service works the phones and the shared inboxes, so those are its
  // list on top of the common pair. Both phone systems are described in
  // docs/phone-metrics-explained.md: CIK is the office system with a per-store
  // QCWS portal, Grasshopper the VoIP account whose numbers forward into it.
  // Neither is handed out per person today — the scraper holds the account —
  // so they start at "none" and an admin raises a row if this hire actually
  // needs to sign in to the portal. A starting list, expected to grow.
  customer_service: [
    RF_TOOLS,
    GOOGLE_WORKSPACE,
    { system: "Shared inboxes (Gmail)", login_method: "google_sso", owner_email: PLACEHOLDER_OWNER },
    { system: "CIK phone portal", login_method: "none", owner_email: PLACEHOLDER_OWNER },
    { system: "Grasshopper", login_method: "none", owner_email: PLACEHOLDER_OWNER },
    { system: "Shopify", login_method: "none", owner_email: PLACEHOLDER_OWNER },
  ],
  warehouse: [
    RF_TOOLS,
    GOOGLE_WORKSPACE,
    { system: "Order Stream", login_method: "none", owner_email: PLACEHOLDER_OWNER },
    { system: "Shopify", login_method: "none", owner_email: PLACEHOLDER_OWNER },
  ],
  sales: [
    RF_TOOLS,
    GOOGLE_WORKSPACE,
    { system: "Shopify", login_method: "none", owner_email: PLACEHOLDER_OWNER },
    { system: "Image library", login_method: "password", owner_email: PLACEHOLDER_OWNER },
  ],
  management: [
    RF_TOOLS,
    GOOGLE_WORKSPACE,
    { system: "Shopify", login_method: "none", owner_email: PLACEHOLDER_OWNER },
    { system: "Image library", login_method: "password", owner_email: PLACEHOLDER_OWNER },
    { system: "InvoiceBox", login_method: "none", owner_email: PLACEHOLDER_OWNER },
  ],
};

/**
 * The starting rows for a department. All five real departments have a template;
 * an unknown one is still not an error, because a department invented on an
 * existing profile must let the admin build the list by hand rather than make
 * the form refuse to open.
 */
export function accessTemplateFor(department: string | null | undefined): AccessTemplateRow[] {
  if (!department) return [];
  return DEPARTMENT_ACCESS[department] ?? [];
}
