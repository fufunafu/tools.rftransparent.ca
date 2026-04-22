"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Location {
  id: string;
  name: string;
  shopify_store_ids: string[];
}

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  department: string;
  location_id: string | null;
  shopify_tags: string[];
  active: boolean;
  locations: Location | null;
}

interface EditDraft {
  name: string;
  email: string;
  phone: string;
  birthday: string;
  department: string;
  location_id: string;
  shopify_tags: string; // comma-separated
  active: boolean;
}

const DEPT_LABELS: Record<string, string> = {
  sales: "Sales",
  marketing: "Marketing",
  customer_service: "Customer Service",
  warehouse: "Warehouse",
  management: "Management",
};

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_service", label: "Customer Service" },
  { value: "warehouse", label: "Warehouse" },
  { value: "management", label: "Management" },
];

const NEW_ID = "__new__";

function emptyDraft(): EditDraft {
  return { name: "", email: "", phone: "", birthday: "", department: "sales", location_id: "", shopify_tags: "", active: true };
}

function draftFromEmployee(emp: Employee): EditDraft {
  return {
    name: emp.name,
    email: emp.email ?? "",
    phone: emp.phone ?? "",
    birthday: emp.birthday ?? "",
    department: emp.department,
    location_id: emp.location_id ?? "",
    shopify_tags: (emp.shopify_tags ?? []).join(", "),
    active: emp.active,
  };
}

const INPUT_CLS =
  "w-full rounded border border-sand-200 px-2 py-1 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none bg-white";

function EditRow({
  draft,
  setField,
  locations,
  saving,
  error,
  onSave,
  onCancel,
  nameRef,
}: {
  draft: EditDraft;
  setField: <K extends keyof EditDraft>(key: K, value: EditDraft[K]) => void;
  locations: Location[];
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSave();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className="border-b border-accent/20 bg-blue-50/60" onKeyDown={handleKey}>
      <td className="px-3 py-2">
        <input
          ref={nameRef}
          type="text"
          value={draft.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder="Employee name"
          className={INPUT_CLS}
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={draft.department}
          onChange={(e) => setField("department", e.target.value)}
          className={INPUT_CLS}
        >
          {DEPARTMENTS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          value={draft.location_id}
          onChange={(e) => setField("location_id", e.target.value)}
          className={INPUT_CLS}
        >
          <option value="">No location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={draft.shopify_tags}
          onChange={(e) => setField("shopify_tags", e.target.value)}
          placeholder="tag1, tag2"
          className={INPUT_CLS}
        />
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setField("active", e.target.checked)}
            className="rounded border-sand-300 text-accent focus:ring-accent"
          />
          <span className="text-xs text-sand-600">Active</span>
        </label>
      </td>
      <td className="px-3 py-2">
        <input
          type="email"
          value={draft.email}
          onChange={(e) => setField("email", e.target.value)}
          placeholder="employee@example.com"
          className={INPUT_CLS}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="tel"
          value={draft.phone}
          onChange={(e) => setField("phone", e.target.value)}
          placeholder="+1 514 555 0000"
          className={INPUT_CLS}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={draft.birthday}
          onChange={(e) => setField("birthday", e.target.value)}
          className={INPUT_CLS}
        />
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {error && <span className="text-xs text-red-500 block mb-1">{error}</span>}
        <button
          onClick={onSave}
          disabled={saving}
          className="text-sm font-medium text-accent hover:text-accent-dark mr-3 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-sand-400 hover:text-sand-600 transition-colors"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!showInactive) params.set("active", "true");
      const res = await fetch(`/api/kpi/employees?${params}`);
      setEmployees(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/kpi/locations")
      .then((r) => r.json())
      .then((d) => setLocations(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (editingId) nameRef.current?.focus();
  }, [editingId]);

  const startEdit = (emp: Employee) => {
    if (editingId) return;
    setEditingId(emp.id);
    setDraft(draftFromEmployee(emp));
    setSaveError("");
  };

  const startAdd = () => {
    if (editingId) return;
    setEditingId(NEW_ID);
    setDraft(emptyDraft());
    setSaveError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setSaveError("");
  };

  const setField = <K extends keyof EditDraft>(key: K, value: EditDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
    if (!draft.name.trim()) {
      setSaveError("Name is required");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const isNew = editingId === NEW_ID;
      const body = {
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase() || null,
        phone: draft.phone.trim() || null,
        birthday: draft.birthday || null,
        department: draft.department,
        location_id: draft.location_id || null,
        shopify_tags: draft.shopify_tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        active: draft.active,
      };
      const res = await fetch(
        isNew ? "/api/kpi/employees" : `/api/kpi/employees/${editingId}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      setEditingId(null);
      load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this employee? This also removes their KPI entries."))
      return;
    setDeleting(id);
    try {
      await fetch(`/api/kpi/employees/${id}`, { method: "DELETE" });
      load();
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  };

  const filtered = employees.filter(
    (e) =>
      !filter ||
      e.name.toLowerCase().includes(filter.toLowerCase()) ||
      e.department.includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-sand-900">Employees</h2>
        <span className="text-sm text-sand-400">{employees.length} total</span>
        <div className="ml-auto flex items-center gap-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search..."
            className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 bg-white w-48"
          />
          <label className="flex items-center gap-1.5 text-sm text-sand-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-sand-300 text-accent focus:ring-accent"
            />
            Show inactive
          </label>
          <button
            onClick={startAdd}
            disabled={!!editingId}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-40"
          >
            + Add Employee
          </button>
        </div>
      </div>

      {editingId && (
        <p className="text-xs text-sand-400">
          Click <kbd className="px-1 py-0.5 rounded bg-sand-100 font-mono">Save</kbd> or press{" "}
          <kbd className="px-1 py-0.5 rounded bg-sand-100 font-mono">Enter</kbd> to save ·{" "}
          <kbd className="px-1 py-0.5 rounded bg-sand-100 font-mono">Esc</kbd> to cancel
        </p>
      )}

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Department
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Location
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Shopify Tags
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Google Email
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Phone (WhatsApp)
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Birthday
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sand-400">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && editingId !== NEW_ID && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sand-400">
                    No employees found.
                  </td>
                </tr>
              )}

              {filtered.map((emp) =>
                editingId === emp.id ? (
                  <EditRow
                    key={emp.id}
                    draft={draft}
                    setField={setField}
                    locations={locations}
                    saving={saving}
                    error={saveError}
                    onSave={handleSave}
                    onCancel={cancelEdit}
                    nameRef={nameRef}
                  />
                ) : (
                  <tr
                    key={emp.id}
                    onClick={() => startEdit(emp)}
                    className={`border-b border-sand-50 transition-colors ${
                      editingId ? "cursor-default" : "hover:bg-sand-50/50 cursor-pointer"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-sand-900">{emp.name}</td>
                    <td className="px-4 py-3 text-sand-600">
                      {DEPT_LABELS[emp.department] ?? emp.department}
                    </td>
                    <td className="px-4 py-3 text-sand-500">
                      {emp.locations?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sand-400 font-mono text-xs">
                      {emp.shopify_tags?.length > 0 ? emp.shopify_tags.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          emp.active
                            ? "bg-green-50 text-green-700"
                            : "bg-sand-100 text-sand-400"
                        }`}
                      >
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sand-500 text-xs">
                      {emp.email ?? <span className="text-sand-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sand-500 text-xs">
                      {emp.phone ?? <span className="text-sand-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sand-500 text-xs">
                      {emp.birthday
                        ? new Date(emp.birthday + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : <span className="text-sand-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(emp.id);
                        }}
                        disabled={deleting === emp.id || !!editingId}
                        className="text-sm text-red-400 hover:text-red-600 transition-colors disabled:opacity-40"
                      >
                        {deleting === emp.id ? "…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                )
              )}

              {/* New row appended at the bottom */}
              {editingId === NEW_ID && (
                <EditRow
                  draft={draft}
                  setField={setField}
                  locations={locations}
                  saving={saving}
                  error={saveError}
                  onSave={handleSave}
                  onCancel={cancelEdit}
                  nameRef={nameRef}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
