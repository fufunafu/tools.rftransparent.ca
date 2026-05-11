"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";

interface Location {
  id: string;
  name: string;
}

export interface EditDraft {
  name: string;
  email: string;
  phone: string;
  birthday: string;
  department: string;
  location_id: string;
  shopify_tags: string;
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
}

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_service", label: "Customer Service" },
  { value: "warehouse", label: "Warehouse" },
  { value: "management", label: "Management" },
];

const FIELD_CLS =
  "w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none";

const LABEL_CLS = "block text-sm font-medium text-sand-700 mb-1";

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
}: Props) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => !saving && !deleting && onCancel()}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "New employee" : "Edit employee"}
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-sand-200">
          <h2 className="text-lg font-semibold text-sand-900">
            {mode === "create" ? "New employee" : "Edit employee"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || deleting}
            aria-label="Close"
            className="text-sand-400 hover:text-sand-700 transition-colors disabled:opacity-50 text-xl leading-none"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
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
                Google Email
                <span className="text-sand-400 font-normal ml-1">(grants admin access)</span>
              </label>
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="employee@example.com"
                className={FIELD_CLS}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Phone (WhatsApp)</label>
                <input
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="+1 514 555 0000"
                  className={FIELD_CLS}
                />
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

            <div>
              <label className={LABEL_CLS}>
                Shopify Tags
                <span className="text-sand-400 font-normal ml-1">
                  (comma-separated — all aliases that match order tags)
                </span>
              </label>
              <input
                type="text"
                value={draft.shopify_tags}
                onChange={(e) => setField("shopify_tags", e.target.value)}
                placeholder="e.g. Rob, rob, Robert, Robert Glas"
                className={FIELD_CLS}
              />
              <p className="text-xs text-sand-400 mt-1">
                Matching is case-insensitive. Add all variations used in Shopify.
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setField("active", e.target.checked)}
                className="rounded border-sand-300 text-accent focus:ring-accent"
              />
              <span className="text-sm text-sand-700">Active</span>
            </label>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          <footer className="flex items-center gap-2 px-5 py-3 border-t border-sand-200 bg-sand-50/50">
            {mode === "edit" && onDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
                className="text-sm text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving || deleting}
                className="px-4 py-2 text-sm text-sand-600 hover:text-sand-900 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || deleting || !draft.name.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
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
    </>
  );
}
