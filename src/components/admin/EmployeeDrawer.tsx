"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { getInternationalPhoneError } from "@/lib/phone";

interface Location {
  id: string;
  name: string;
}

export interface EditDraft {
  name: string;
  email: string;
  email_alt: string;
  phone: string;
  birthday: string;
  hire_date: string;
  employment_ended_at: string;
  exit_survey_enabled: boolean;
  department: string;
  location_id: string;
  shopify_tags: string;
  commission_percent: string;
  active: boolean;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  draft: EditDraft;
  setField: <K extends keyof EditDraft>(key: K, value: EditDraft[K]) => void;
  locations: Location[];
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  isAdmin?: boolean;
  employeeId?: string | null;
}

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_service", label: "Customer Service" },
  { value: "warehouse", label: "Warehouse" },
  { value: "management", label: "Management" },
];

const FIELD_CLS =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

const LABEL_CLS = "mb-1.5 block text-xs font-semibold text-slate-700";

export default function EmployeeDrawer({
  open,
  mode,
  draft,
  setField,
  locations,
  saving,
  error,
  onSave,
  onCancel,
  onDelete,
  deleting = false,
  isAdmin = false,
  employeeId = null,
}: Props) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const phoneError = getInternationalPhoneError(draft.phone);

  useEffect(() => {
    if (!passwordOpen) {
      setNewPassword("");
      setPwError("");
    }
  }, [passwordOpen]);

  useEffect(() => {
    if (!open) setPwSuccess("");
  }, [open]);

  const handleSetPassword = async () => {
    if (!employeeId) return;
    if (newPassword.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    setPwSaving(true);
    setPwError("");
    try {
      const res = await fetch("/api/admin/users/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(data.error || "Failed to set password.");
        return;
      }
      setPwSuccess(
        data.status === "created"
          ? `Login created. They can sign in with ${data.email} and the password you just set.`
          : `Password updated. They can sign in with ${data.email} and the new password.`,
      );
      setPasswordOpen(false);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPwSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving && !deleting && !confirmDelete) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, deleting, confirmDelete, onCancel]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => nameRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave();
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => !saving && !deleting && onCancel()}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "New employee" : "Edit employee"}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5" aria-hidden="true">
                <circle cx="12" cy="8.25" r="3.25" />
                <path strokeLinecap="round" d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
                {mode === "create" && <path strokeLinecap="round" d="M18.5 4v5M16 6.5h5" />}
              </svg>
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                {mode === "create" ? "Add employee" : "Edit employee"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {mode === "create" ? "Create a new team profile" : "Update profile and access details"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || deleting}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            <div>
              <label className={LABEL_CLS}>Name</label>
              <input
                ref={nameRef}
                type="text"
                value={draft.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Employee name"
                className={FIELD_CLS}
                required
              />
            </div>

            <div>
              <label className={LABEL_CLS}>
                Work Email
                <span className="ml-1 font-normal text-slate-400">(grants access)</span>
              </label>
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="employee@glass-railing.com"
                className={FIELD_CLS}
              />
            </div>

            <div>
              <label className={LABEL_CLS}>
                Personal Email
                <span className="ml-1 font-normal text-slate-400">(optional, also grants access)</span>
              </label>
              <input
                type="email"
                value={draft.email_alt}
                onChange={(e) => setField("email_alt", e.target.value)}
                placeholder="employee@gmail.com"
                className={FIELD_CLS}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Department</label>
                <select
                  value={draft.department}
                  onChange={(e) => setField("department", e.target.value)}
                  className={FIELD_CLS}
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Location</label>
                <select
                  value={draft.location_id}
                  onChange={(e) => setField("location_id", e.target.value)}
                  className={FIELD_CLS}
                >
                  <option value="">No location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Phone (WhatsApp)</label>
                <input
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="+1 514 555 0000"
                  aria-invalid={phoneError ? "true" : undefined}
                  aria-describedby="employee-phone-help"
                  className={`${FIELD_CLS} ${phoneError ? "border-red-300 focus:border-red-500 focus:ring-red-500/10" : ""}`}
                />
                <p
                  id="employee-phone-help"
                  className={`mt-1.5 text-xs leading-4 ${phoneError ? "text-red-600" : "text-slate-400"}`}
                >
                  {phoneError ?? "Include + and the country code. Saved in international format."}
                </p>
              </div>
              <div>
                <label className={LABEL_CLS}>Birthday</label>
                <input
                  type="date"
                  value={draft.birthday}
                  onChange={(e) => setField("birthday", e.target.value)}
                  className={FIELD_CLS}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Hire Date</label>
                <input
                  type="date"
                  value={draft.hire_date}
                  onChange={(e) => setField("hire_date", e.target.value)}
                  className={FIELD_CLS}
                />
                <p className="mt-1.5 text-xs leading-4 text-slate-400">Starts day 14, 45, and 90 onboarding check-ins.</p>
              </div>
              <div>
                <label className={LABEL_CLS}>Employment End Date</label>
                <input
                  type="date"
                  value={draft.employment_ended_at}
                  onChange={(e) => setField("employment_ended_at", e.target.value)}
                  className={FIELD_CLS}
                />
                <label className="mt-2 flex items-start gap-2 text-xs leading-4 text-slate-500">
                  <input
                    type="checkbox"
                    checked={draft.exit_survey_enabled}
                    onChange={(e) => setField("exit_survey_enabled", e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Offer the voluntary exit survey
                </label>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>
                Shopify Tags
                <span className="ml-1 font-normal text-slate-400">
                  (comma-separated, all aliases that match order tags)
                </span>
              </label>
              <input
                type="text"
                value={draft.shopify_tags}
                onChange={(e) => setField("shopify_tags", e.target.value)}
                placeholder="e.g. Rob, rob, Robert, Robert Glas"
                className={FIELD_CLS}
              />
              <p className="mt-1.5 text-xs leading-5 text-slate-400">
                Matching is case-insensitive. Add all variations used in Shopify.
              </p>
            </div>

            {draft.department === "sales" && (
              <div>
                <label className={LABEL_CLS}>
                  Commission Rate
                  <span className="ml-1 font-normal text-slate-400">
                    (% of net revenue on tagged orders)
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={draft.commission_percent}
                    onChange={(e) => setField("commission_percent", e.target.value)}
                    placeholder="e.g. 5"
                    className={`${FIELD_CLS} pr-8`}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-slate-400">
                    %
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">
                  Used by the Sales commissions panel. Net revenue is money
                  collected minus taxes, shipping, and refunds.
                </p>
              </div>
            )}

            {isAdmin && mode === "edit" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <label className={LABEL_CLS}>
                  Sign-in & Password
                  <span className="ml-1 font-normal text-slate-400">(for employees without Google)</span>
                </label>
                <p className="mb-3 text-xs leading-5 text-slate-500">
                  {draft.email
                    ? `They'll sign in at the login page with ${draft.email} and the password you set.`
                    : "Set a work email above first. It becomes their login username."}
                </p>
                <button
                  type="button"
                  onClick={() => setPasswordOpen(true)}
                  disabled={!draft.email || saving || deleting}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  Set / reset password
                </button>
                {pwSuccess && (
                  <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
                    {pwSuccess}
                  </p>
                )}
              </div>
            )}

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span>
                <span className="block text-sm font-semibold text-slate-800">Active employee</span>
                <span className="mt-0.5 block text-xs text-slate-400">Active profiles can sign in and appear in reporting.</span>
              </span>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setField("active", e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
            {mode === "edit" && onDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
                className="rounded-lg px-2 py-2 text-xs font-semibold text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving || deleting}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || deleting || !draft.name.trim()}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving ? "Saving…" : mode === "create" ? "Add employee" : "Save changes"}
              </button>
            </div>
          </footer>
        </form>
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete employee?"
        message="This also removes their KPI entries. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        busy={deleting}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete?.();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      {passwordOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
          onClick={() => !pwSaving && setPasswordOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-950">Set password</h3>
            <p className="text-sm leading-6 text-slate-500">
              They&apos;ll sign in with <span className="font-medium">{draft.email}</span> and the password you set
              here. Tell them in person. We don&apos;t send it by email.
            </p>
            <div>
              <label className={LABEL_CLS}>New password</label>
              <input
                type="text"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={FIELD_CLS}
                autoFocus
              />
            </div>
            {pwError && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {pwError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPasswordOpen(false)}
                disabled={pwSaving}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSetPassword}
                disabled={pwSaving || newPassword.length < 8}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
              >
                {pwSaving ? "Saving…" : "Save password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
