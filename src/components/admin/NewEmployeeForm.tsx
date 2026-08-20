"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildOnboardingHtml,
  buildOnboardingText,
  buildOnboardingWhatsApp,
  type OnboardingMessage,
  type OnboardingMessageRow,
} from "@/lib/onboarding-message";
import {
  ACCESS_STATUS_LABELS,
  LOGIN_METHOD_LABELS,
  accessTemplateFor,
  type AccessStatus,
  type LoginMethod,
} from "@/lib/access-templates";

// Same two constants the employee drawer uses, so the new page reads as part
// of the same application rather than a second design.
const FIELD_CLS =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
const LABEL_CLS = "mb-1.5 block text-xs font-semibold text-slate-700";

const DEPT_LABELS: Record<string, string> = {
  sales: "Sales",
  marketing: "Marketing",
  customer_service: "Customer Service",
  warehouse: "Warehouse",
  management: "Management",
};

const LOGIN_METHODS: LoginMethod[] = ["google_sso", "microsoft_sso", "password", "magic_link", "none"];
const STATUSES: AccessStatus[] = ["not_requested", "requested", "active", "revoked"];

interface AccessDraft {
  key: string;
  system: string;
  login_method: LoginMethod;
  account_id: string;
  owner_email: string;
  status: AccessStatus;
  note: string;
  // Typed here, sent in the welcome message, never written to a column.
  password: string;
}

let seq = 0;
const nextKey = () => `row-${seq++}`;

function draftsFor(department: string): AccessDraft[] {
  return accessTemplateFor(department).map((row) => ({
    key: nextKey(),
    system: row.system,
    login_method: row.login_method,
    account_id: "",
    owner_email: row.owner_email,
    status: "not_requested",
    note: "",
    password: "",
  }));
}

// Google is the one method a reader should be able to pick out without reading
// the label — "which of these is just my Google account" is the question they
// arrive with.
function methodBadgeCls(method: LoginMethod): string {
  if (method === "google_sso") return "border-blue-200 bg-blue-50 text-blue-700";
  if (method === "none") return "border-slate-200 bg-slate-50 text-slate-500";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

export default function NewEmployeeForm({
  departments,
  locations,
}: {
  departments: string[];
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailAlt, setEmailAlt] = useState("");
  const [department, setDepartment] = useState("");
  const [locationId, setLocationId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [phone, setPhone] = useState("");

  const [toolsSignIn, setToolsSignIn] = useState<"google" | "password">("google");
  const [password, setPassword] = useState("");

  const [rows, setRows] = useState<AccessDraft[]>([]);
  const [touchedRows, setTouchedRows] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<
    { emailed: boolean; passwordStatus: string; message: OnboardingMessage } | null
  >(null);
  const [copied, setCopied] = useState<"email" | "whatsapp" | null>(null);

  // Changing department refills the list — unless the admin has already edited
  // it, in which case their work outranks the template.
  const onDepartmentChange = (value: string) => {
    setDepartment(value);
    if (!touchedRows) setRows(draftsFor(value));
  };

  const editRow = <K extends keyof AccessDraft>(key: string, field: K, value: AccessDraft[K]) => {
    setTouchedRows(true);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    setTouchedRows(true);
    setRows((current) => [
      ...current,
      { key: nextKey(), system: "", login_method: "none", account_id: "", owner_email: "", status: "not_requested", note: "", password: "" },
    ]);
  };

  const removeRow = (key: string) => {
    setTouchedRows(true);
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const bootstrapLine = useMemo(
    () =>
      toolsSignIn === "google"
        ? "Sign in with your company Google account. There is no password to set up."
        : `Username ${email.trim().toLowerCase() || "—"} · Password ${password || "—"}`,
    [toolsSignIn, email, password],
  );

  const canSubmit =
    name.trim() && email.trim() && department.trim() && (toolsSignIn === "google" || password.length >= 8);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch("/api/employees/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          email_alt: emailAlt,
          department,
          location_id: locationId || null,
          hire_date: hireDate || null,
          phone,
          tools_sign_in: toolsSignIn,
          password: toolsSignIn === "password" ? password : undefined,
          access: rows
            .filter((row) => row.system.trim())
            .map((row) => ({
              system: row.system,
              login_method: row.login_method,
              account_id: row.account_id,
              owner_email: row.owner_email,
              status: row.status,
              note: row.note,
              password: row.password,
            })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create the employee");
      setDone({
        emailed: data.emailed,
        passwordStatus: data.passwordStatus,
        // Built from what the server echoed back, so the copy buttons hand over
        // the same words the person was emailed.
        message: {
          name,
          email: email.trim().toLowerCase(),
          department,
          hireDate: hireDate || null,
          toolsSignIn,
          toolsPassword: toolsSignIn === "password" ? password : null,
          rows: (data.access ?? []) as OnboardingMessageRow[],
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the employee");
    } finally {
      setSaving(false);
    }
  };

  // The same words that were emailed, in whichever shape the admin needs to
  // paste them. Built from the message rather than re-described, so the copy
  // and the email can never drift apart.
  const flash = (which: "email" | "whatsapp") => {
    setCopied(which);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const copyForEmail = async () => {
    if (!done) return;
    const html = buildOnboardingHtml(done.message);
    const text = buildOnboardingText(done.message);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      // Rich-text writes are refused in some browsers and contexts; the markup
      // itself is still more useful than nothing.
      await navigator.clipboard.writeText(html);
    }
    flash("email");
  };

  const copyForWhatsApp = async () => {
    if (!done) return;
    await navigator.clipboard.writeText(buildOnboardingWhatsApp(done.message));
    flash("whatsapp");
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">{name} is set up</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {done.emailed
            ? `The welcome email is on its way to ${email.trim().toLowerCase()}.`
            : "The profile and access list were saved, but the welcome email could not be sent. Send it another way, or ask an admin to check Resend on the health-check page."}
        </p>
        {done.passwordStatus === "failed" && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            The password could not be provisioned. They cannot sign in yet — set one from the
            employee hub before their first day.
          </p>
        )}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-left">
          <p className="text-xs font-semibold text-slate-700">Send it again yourself</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            The same message, in either shape. It carries the passwords, so treat the
            clipboard accordingly.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={copyForEmail}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {copied === "email" ? "Copied" : "Copy for email"}
            </button>
            <button
              type="button"
              onClick={copyForWhatsApp}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {copied === "whatsapp" ? "Copied" : "Copy for WhatsApp"}
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/employees")}
            className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Back to the hub
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">People</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">New employee</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Create the profile, decide what they can sign in to, and send them one message that
          says how. The access list starts from their department and stays editable.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold text-slate-950">Who they are</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={LABEL_CLS} htmlFor="ne-name">Full name</label>
                <input id="ne-name" className={FIELD_CLS} value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ne-email">Work email</label>
                <input id="ne-email" type="email" autoComplete="off" className={FIELD_CLS} value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ne-email-alt">Personal email (optional)</label>
                <input id="ne-email-alt" type="email" autoComplete="off" className={FIELD_CLS} value={emailAlt} onChange={(e) => setEmailAlt(e.target.value)} />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ne-department">Department</label>
                <select id="ne-department" className={FIELD_CLS} value={department} onChange={(e) => onDepartmentChange(e.target.value)} required>
                  <option value="">Choose…</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>{DEPT_LABELS[dept] ?? dept}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ne-location">Location</label>
                <select id="ne-location" className={FIELD_CLS} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">No location</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ne-hire">Start date</label>
                <input id="ne-hire" type="date" className={FIELD_CLS} value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ne-phone">Phone (optional)</label>
                <input id="ne-phone" className={FIELD_CLS} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold text-slate-950">How they get into RF Tools</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              There are only two ways in for a brand-new account. “Forgot your password?” is not
              one of them — it cannot create an account that has never signed in.
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Passwords you type here are sent to the person in one message and are never stored
              in this application. That message is the only copy.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["google", "password"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setToolsSignIn(option)}
                  aria-pressed={toolsSignIn === option}
                  className={`rounded-xl border p-3.5 text-left transition ${
                    toolsSignIn === option
                      ? "border-blue-500 bg-blue-50/60 ring-4 ring-blue-500/10"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-900">
                    {option === "google" ? "Company Google account" : "Password set by an admin"}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {option === "google"
                      ? "Nothing to provision. They choose Continue with Google."
                      : "Created in Supabase Auth and printed in the welcome message. Never written to a column here."}
                  </span>
                </button>
              ))}
            </div>
            {toolsSignIn === "password" && (
              <div className="mt-4">
                <label className={LABEL_CLS} htmlFor="ne-password">Password (at least 8 characters)</label>
                <input
                  id="ne-password"
                  type="password"
                  autoComplete="new-password"
                  className={FIELD_CLS}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Goes into the welcome message and into Supabase Auth. It is not stored here, so
                  this message is the only copy.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">What they can sign in to</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {department ? "Filled in from their department. Edit anything." : "Choose a department to start the list."}
                </p>
              </div>
              <button
                type="button"
                onClick={addRow}
                className="min-h-9 shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Add a system
              </button>
            </div>

            <ul className="mt-4 space-y-3">
              {rows.map((row) => (
                <li key={row.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${methodBadgeCls(row.login_method)}`}>
                      {LOGIN_METHOD_LABELS[row.login_method]}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="text-xs font-medium text-slate-400 transition hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>System</label>
                      <input className={FIELD_CLS} value={row.system} onChange={(e) => editRow(row.key, "system", e.target.value)} placeholder="Shopify" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Sign-in method</label>
                      <select className={FIELD_CLS} value={row.login_method} onChange={(e) => editRow(row.key, "login_method", e.target.value as LoginMethod)}>
                        {LOGIN_METHODS.map((method) => (
                          <option key={method} value={method}>{LOGIN_METHOD_LABELS[method]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Username (blank = work email)</label>
                      <input className={FIELD_CLS} value={row.account_id} onChange={(e) => editRow(row.key, "account_id", e.target.value)} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>
                        {row.login_method === "google_sso" ? "Password (not needed)" : "Password"}
                      </label>
                      <input
                        className={FIELD_CLS}
                        value={row.password}
                        onChange={(e) => editRow(row.key, "password", e.target.value)}
                        disabled={row.login_method === "google_sso"}
                        placeholder={row.login_method === "google_sso" ? "Google account" : "Goes in the welcome message"}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Who to ask</label>
                      <input className={FIELD_CLS} value={row.owner_email} onChange={(e) => editRow(row.key, "owner_email", e.target.value)} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Status</label>
                      <select className={FIELD_CLS} value={row.status} onChange={(e) => editRow(row.key, "status", e.target.value as AccessStatus)}>
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>{ACCESS_STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Note (optional)</label>
                      <input className={FIELD_CLS} value={row.note} onChange={(e) => editRow(row.key, "note", e.target.value)} />
                    </div>
                  </div>
                </li>
              ))}
              {rows.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  No systems yet.
                </li>
              )}
            </ul>
          </section>
        </div>

        {/* The message the person will actually receive, redrawn as the form is
            filled in. Onboarding email copy is the part nobody reviews until it
            has already been sent to somebody. */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">Their email</p>
              <p className="mt-1 truncate text-sm font-medium text-slate-700">
                To: {email.trim().toLowerCase() || "—"}
              </p>
            </div>
            <div className="space-y-4 px-5 py-5 text-sm">
              <p className="text-base font-semibold text-slate-950">Welcome{name ? `, ${name}` : ""}</p>
              <p className="text-slate-500">
                Here is what has been set up for you in {DEPT_LABELS[department] ?? (department || "—")}
                {hireDate ? `, starting ${hireDate}` : ""}.
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700">Getting into RF Tools</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{bootstrapLine}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">Your accounts</p>
                <ul className="mt-2 space-y-1.5">
                  {rows.filter((row) => row.system.trim()).map((row) => (
                    <li key={row.key} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-800">{row.system}</span>
                      <span className="text-slate-500">
                        {row.login_method === "google_sso"
                          ? "Google account"
                          : `${row.account_id.trim() || "work email"} · ${row.password.trim() || "no password"}`}
                      </span>
                    </li>
                  ))}
                  {rows.filter((row) => row.system.trim()).length === 0 && (
                    <li className="text-xs text-slate-400">Nothing is set up yet.</li>
                  )}
                </ul>
              </div>
              <p className="inline-block rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
                See your access list
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={!canSubmit || saving}
              className="min-h-11 flex-1 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {saving ? "Creating…" : "Create and send"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/employees")}
              className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}
