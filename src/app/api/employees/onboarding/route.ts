import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { normalizeOptionalInternationalPhone } from "@/lib/phone";
import { recordSettingChange } from "@/lib/settings-audit";
import { getSupabase } from "@/lib/supabase";
import { sendOnboardingEmail } from "@/lib/onboarding-email";
import type { OnboardingMessageRow } from "@/lib/onboarding-message";
import type { AccessStatus, LoginMethod } from "@/lib/access-templates";

const LOGIN_METHODS: LoginMethod[] = [
  "google_sso",
  "microsoft_sso",
  "password",
  "magic_link",
  "none",
];
const STATUSES: AccessStatus[] = ["not_requested", "requested", "active", "revoked"];

interface AccessInput {
  system?: string;
  login_method?: string;
  account_id?: string;
  owner_email?: string;
  status?: string;
  note?: string;
  // Typed on the form, forwarded to the message, and dropped on the floor
  // afterwards. It is deliberately absent from the insert below.
  password?: string;
}

/**
 * Creates an employee, the access rows that go with them, and the welcome
 * email — in that order, because each step is worth keeping even if the next
 * one fails. Admin only: an employees row is what grants a person a way into
 * the application at all (see isAuthorizedEmail), so this is the same gate the
 * plain employee POST uses.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actor = (await getAuthenticatedUser())?.email ?? "unknown";

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const {
    name,
    email,
    email_alt,
    department,
    location_id,
    hire_date,
    phone,
    access,
    tools_sign_in,
    password,
  } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required", field: "name" }, { status: 400 });
  }
  if (typeof department !== "string" || !department.trim()) {
    return NextResponse.json({ error: "department is required", field: "department" }, { status: 400 });
  }
  // The welcome email is the point of this route, so unlike the plain employee
  // POST a work address is not optional here.
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "A work email is required to send the welcome message", field: "email" }, { status: 400 });
  }

  const signIn = tools_sign_in === "password" ? "password" : "google";
  if (signIn === "password" && (typeof password !== "string" || password.length < 8)) {
    return NextResponse.json(
      { error: "A password of at least 8 characters is required for the password sign-in method", field: "password" },
      { status: 400 },
    );
  }

  let normalizedPhone: string | null;
  try {
    normalizedPhone = normalizeOptionalInternationalPhone(phone as string | undefined);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid phone number", field: "phone" },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const workEmail = email.trim().toLowerCase();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .insert({
      name: name.trim(),
      email: workEmail,
      email_alt: typeof email_alt === "string" && email_alt.trim() ? email_alt.trim().toLowerCase() : null,
      department: department.trim(),
      location_id: location_id || null,
      hire_date: hire_date || null,
      phone: normalizedPhone,
      active: true,
    })
    .select("*, locations(id, name)")
    .single();

  if (employeeError || !employee) {
    return NextResponse.json({ error: employeeError?.message ?? "Could not create the employee" }, { status: 500 });
  }

  // Access rows next. A failure here leaves a real employee behind, which is
  // recoverable from the hub; rolling the person back would not be.
  const rows = Array.isArray(access) ? (access as AccessInput[]) : [];
  const normalized = rows
    .filter((row) => typeof row?.system === "string" && row.system.trim())
    .map((row) => ({
      system: row.system!.trim(),
      login_method: LOGIN_METHODS.includes(row.login_method as LoginMethod)
        ? (row.login_method as LoginMethod)
        : ("none" as LoginMethod),
      account_id: row.account_id?.trim() || null,
      owner_email: row.owner_email?.trim().toLowerCase() || null,
      status: STATUSES.includes(row.status as AccessStatus)
        ? (row.status as AccessStatus)
        : ("not_requested" as AccessStatus),
      note: row.note?.trim() || null,
      password: row.password?.trim() || null,
    }));

  // Two shapes from one list, and the difference between them is the whole
  // password boundary: the message gets the secret, the table never does.
  // `password` is absent from this object by construction rather than deleted
  // afterwards, so a new column can't quietly start carrying it.
  const messageRows: OnboardingMessageRow[] = normalized.map((row) => ({
    system: row.system,
    login_method: row.login_method,
    account_id: row.account_id,
    password: row.password,
    owner_email: row.owner_email,
    status: row.status,
  }));

  if (normalized.length) {
    const { error: accessError } = await supabase.from("employee_access").insert(
      normalized.map((row) => ({
        employee_id: employee.id as string,
        system: row.system,
        login_method: row.login_method,
        account_id: row.account_id,
        owner_email: row.owner_email,
        status: row.status,
        note: row.note,
      })),
    );
    if (accessError) {
      return NextResponse.json(
        { error: `The employee was created, but their access list was not saved: ${accessError.message}`, employee },
        { status: 500 },
      );
    }
  }

  // The password path, when the admin chose it. It goes to Supabase Auth and
  // nowhere else — no column here holds it, and the email never repeats it.
  // Kept local rather than shared with /api/admin/users/password: that route
  // rotates a password for an existing profile, this one bootstraps an account
  // that has just been created and has no auth user yet.
  let passwordStatus: "created" | "updated" | "failed" | "skipped" = "skipped";
  if (signIn === "password") {
    const created = await supabase.auth.admin.createUser({
      email: workEmail,
      password: password as string,
      email_confirm: true,
    });
    if (!created.error) {
      passwordStatus = "created";
    } else {
      // Already registered — they signed in with Google at some point. Find
      // them and set the password on the existing account instead.
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = list?.users.find((u) => u.email?.toLowerCase() === workEmail);
      if (match) {
        const updated = await supabase.auth.admin.updateUserById(match.id, { password: password as string });
        passwordStatus = updated.error ? "failed" : "updated";
      } else {
        passwordStatus = "failed";
      }
      if (passwordStatus === "failed") {
        console.error("[onboarding] could not provision a password:", created.error.message);
      }
    }
  }

  const emailed = await sendOnboardingEmail({
    name: employee.name as string,
    email: workEmail,
    department: employee.department as string,
    hireDate: (employee.hire_date as string | null) ?? null,
    toolsSignIn: signIn,
    toolsPassword: signIn === "password" ? (password as string) : null,
    rows: messageRows,
  });

  await recordSettingChange({
    area: "access",
    actor,
    summary: `Onboarded ${employee.name} (${workEmail}) in ${employee.department} with ${messageRows.length} access rows, ${signIn} sign-in`,
  });

  return NextResponse.json(
    // The response echoes the message rows, passwords included: the success
    // screen offers "copy for email" and "copy for WhatsApp" and has to be able
    // to reproduce exactly what was sent.
    { employee, access: messageRows, emailed, passwordStatus },
    { status: 201 },
  );
}
