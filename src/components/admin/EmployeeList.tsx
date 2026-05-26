"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import EmployeeDrawer, { type EditDraft } from "@/components/admin/EmployeeDrawer";
import EmployeeFilters, { type StatusFilter } from "@/components/admin/EmployeeFilters";

interface Location {
  id: string;
  name: string;
  shopify_store_ids: string[];
}

interface Employee {
  id: string;
  name: string;
  email: string | null;
  email_alt: string | null;
  phone: string | null;
  birthday: string | null;
  department: string;
  location_id: string | null;
  shopify_tags: string[];
  active: boolean;
  locations: Location | null;
}

const DEPT_LABELS: Record<string, string> = {
  sales: "Sales",
  marketing: "Marketing",
  customer_service: "Customer Service",
  warehouse: "Warehouse",
  management: "Management",
};

const DEPT_COLORS: Record<string, string> = {
  sales: "bg-blue-50 text-blue-700",
  marketing: "bg-purple-50 text-purple-700",
  customer_service: "bg-amber-50 text-amber-700",
  warehouse: "bg-emerald-50 text-emerald-700",
  management: "bg-slate-100 text-slate-700",
};

const NEW_ID = "__new__";

type SortKey = "name" | "department" | "birthday";
type SortDir = "asc" | "desc";

function emptyDraft(): EditDraft {
  return {
    name: "",
    email: "",
    email_alt: "",
    phone: "",
    birthday: "",
    department: "sales",
    location_id: "",
    shopify_tags: "",
    active: true,
  };
}

function draftFromEmployee(emp: Employee): EditDraft {
  return {
    name: emp.name,
    email: emp.email ?? "",
    email_alt: emp.email_alt ?? "",
    phone: emp.phone ?? "",
    birthday: emp.birthday ?? "",
    department: emp.department,
    location_id: emp.location_id ?? "",
    shopify_tags: (emp.shopify_tags ?? []).join(", "),
    active: emp.active,
  };
}

function birthdayKey(b: string | null): number {
  if (!b) return 99_99;
  const [, m, d] = b.split("-").map(Number);
  return (m ?? 99) * 100 + (d ?? 99);
}

function formatBirthday(b: string | null): string {
  if (!b) return "—";
  return new Date(b + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch all; we filter client-side so "All" segment works.
      const res = await fetch(`/api/kpi/employees?active=false`);
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/kpi/locations")
      .then((r) => r.json())
      .then((d) => setLocations(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(Boolean(d?.isAdmin)))
      .catch(() => {});
  }, []);

  const departmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of employees) counts[e.department] = (counts[e.department] ?? 0) + 1;
    return counts;
  }, [employees]);

  const activeCount = useMemo(() => employees.filter((e) => e.active).length, [employees]);
  const inactiveCount = employees.length - activeCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = employees.filter((e) => {
      if (statusFilter === "active" && !e.active) return false;
      if (statusFilter === "inactive" && e.active) return false;
      if (departmentFilter && e.department !== departmentFilter) return false;
      if (locationFilter && e.location_id !== locationFilter) return false;
      if (q) {
        const hay = `${e.name} ${e.email ?? ""} ${e.email_alt ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "department")
        cmp = (DEPT_LABELS[a.department] ?? a.department).localeCompare(
          DEPT_LABELS[b.department] ?? b.department,
        );
      else if (sortKey === "birthday") cmp = birthdayKey(a.birthday) - birthdayKey(b.birthday);
      return cmp * dir;
    });
    return list;
  }, [employees, search, departmentFilter, locationFilter, statusFilter, sortKey, sortDir]);

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
    if (saving || deleting) return;
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
        email_alt: draft.email_alt.trim().toLowerCase() || null,
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
        },
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

  const handleDelete = async () => {
    if (!editingId || editingId === NEW_ID) return;
    setDeleting(true);
    try {
      await fetch(`/api/kpi/employees/${editingId}`, { method: "DELETE" });
      setEditingId(null);
      load();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const clearFilters = () => {
    setSearch("");
    setDepartmentFilter("");
    setLocationFilter("");
    setStatusFilter("active");
  };

  const hasActiveFilters =
    search !== "" ||
    departmentFilter !== "" ||
    locationFilter !== "" ||
    statusFilter !== "active";

  const drawerOpen = editingId !== null;
  const drawerMode: "create" | "edit" = editingId === NEW_ID ? "create" : "edit";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-semibold text-sand-900">Employees</h2>
        <div className="flex items-center gap-1.5 text-xs text-sand-500">
          <span className="px-2 py-0.5 rounded-full bg-sand-100">{employees.length} total</span>
          <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700">
            {activeCount} active
          </span>
          {inactiveCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-sand-100 text-sand-500">
              {inactiveCount} inactive
            </span>
          )}
        </div>
      </div>

      <EmployeeFilters
        search={search}
        onSearch={setSearch}
        department={departmentFilter}
        onDepartment={setDepartmentFilter}
        locationId={locationFilter}
        onLocation={setLocationFilter}
        status={statusFilter}
        onStatus={setStatusFilter}
        locations={locations}
        departmentCounts={departmentCounts}
        onAdd={startAdd}
        addDisabled={drawerOpen}
      />

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100">
                <SortHeader label="Name" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <SortHeader label="Department" active={sortKey === "department"} dir={sortDir} onClick={() => toggleSort("department")} />
                <PlainHeader label="Location" />
                <SortHeader label="Birthday" active={sortKey === "birthday"} dir={sortDir} onClick={() => toggleSort("birthday")} />
                <PlainHeader label="Status" />
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows count={6} />}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-16">
                    <EmptyState
                      hasFilters={hasActiveFilters}
                      onAdd={startAdd}
                      onClearFilters={clearFilters}
                    />
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => startEdit(emp)}
                    className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-sand-900">{emp.name}</div>
                      {emp.email && (
                        <div className="text-xs text-sand-400 mt-0.5">{emp.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          DEPT_COLORS[emp.department] ?? "bg-sand-100 text-sand-600"
                        }`}
                      >
                        {DEPT_LABELS[emp.department] ?? emp.department}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sand-500">{emp.locations?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-sand-500 text-xs">
                      {formatBirthday(emp.birthday)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs ${
                          emp.active ? "text-green-700" : "text-sand-400"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            emp.active ? "bg-green-500" : "bg-sand-300"
                          }`}
                        />
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <EmployeeDrawer
        open={drawerOpen}
        mode={drawerMode}
        draft={draft}
        setField={setField}
        locations={locations}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onCancel={cancelEdit}
        onDelete={drawerMode === "edit" ? handleDelete : undefined}
        deleting={deleting}
        isAdmin={isAdmin}
        employeeId={editingId && editingId !== NEW_ID ? editingId : null}
      />
    </div>
  );
}

function PlainHeader({ label }: { label: string }) {
  return (
    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
      {label}
    </th>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-sand-700 transition-colors ${
          active ? "text-sand-700" : ""
        }`}
      >
        {label}
        <span className="text-[10px]">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-sand-50 last:border-0">
          <td className="px-4 py-3">
            <div className="h-4 w-32 bg-sand-100 rounded animate-pulse" />
            <div className="h-3 w-40 bg-sand-50 rounded animate-pulse mt-1.5" />
          </td>
          <td className="px-4 py-3">
            <div className="h-5 w-20 bg-sand-100 rounded-full animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-24 bg-sand-100 rounded animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-12 bg-sand-100 rounded animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-16 bg-sand-100 rounded animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );
}

function EmptyState({
  hasFilters,
  onAdd,
  onClearFilters,
}: {
  hasFilters: boolean;
  onAdd: () => void;
  onClearFilters: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="text-center space-y-3">
        <p className="text-sand-500 text-sm">No employees match your filters.</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="text-sm font-medium text-accent hover:text-accent-dark"
        >
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="text-center space-y-3">
      <p className="text-sand-500 text-sm">No employees yet.</p>
      <button
        type="button"
        onClick={onAdd}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors"
      >
        + Add your first employee
      </button>
    </div>
  );
}
