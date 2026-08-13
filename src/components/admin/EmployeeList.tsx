"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import EmployeeDrawer, { type EditDraft } from "@/components/admin/EmployeeDrawer";
import EmployeeFilters, { type StatusFilter } from "@/components/admin/EmployeeFilters";
import { normalizeOptionalInternationalPhone } from "@/lib/phone";

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
  commission_rate: number | null;
  hire_date: string | null;
  employment_ended_at: string | null;
  exit_survey_enabled: boolean | null;
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
  sales: "border-blue-200 bg-blue-50 text-blue-700",
  marketing: "border-violet-200 bg-violet-50 text-violet-700",
  customer_service: "border-amber-200 bg-amber-50 text-amber-700",
  warehouse: "border-emerald-200 bg-emerald-50 text-emerald-700",
  management: "border-slate-200 bg-slate-100 text-slate-700",
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
    hire_date: "",
    employment_ended_at: "",
    exit_survey_enabled: true,
    department: "sales",
    location_id: "",
    shopify_tags: "",
    commission_percent: "",
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
    hire_date: emp.hire_date ?? "",
    employment_ended_at: emp.employment_ended_at ?? "",
    exit_survey_enabled: emp.exit_survey_enabled !== false,
    department: emp.department,
    location_id: emp.location_id ?? "",
    shopify_tags: (emp.shopify_tags ?? []).join(", "),
    // Stored as a fraction (0.05); edited as a percentage (5).
    commission_percent: emp.commission_rate
      ? String(+(emp.commission_rate * 100).toFixed(4))
      : "",
    active: emp.active,
  };
}

function birthdayKey(b: string | null): number {
  if (!b) return 99_99;
  const [, m, d] = b.split("-").map(Number);
  return (m ?? 99) * 100 + (d ?? 99);
}

function formatBirthday(b: string | null): string {
  if (!b) return "Not set";
  return new Date(b + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function employeeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || "?").toUpperCase();
}

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

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
    setLoadError("");
    try {
      // Always fetch all; we filter client-side so "All" segment works.
      const res = await fetch(`/api/kpi/employees?active=false`);
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch {
      setLoadError("The employee directory could not be loaded.");
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
  const activeDepartments = useMemo(
    () => new Set(employees.filter((employee) => employee.active).map((employee) => employee.department)).size,
    [employees],
  );
  const activeLocations = useMemo(
    () => new Set(employees.filter((employee) => employee.active && employee.location_id).map((employee) => employee.location_id)).size,
    [employees],
  );
  const birthdaysOnFile = useMemo(
    () => employees.filter((employee) => employee.active && employee.birthday).length,
    [employees],
  );

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
    let normalizedPhone: string | null;
    try {
      normalizedPhone = normalizeOptionalInternationalPhone(draft.phone);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Invalid phone number");
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
        phone: normalizedPhone,
        birthday: draft.birthday || null,
        hire_date: draft.hire_date || null,
        employment_ended_at: draft.employment_ended_at || null,
        exit_survey_enabled: draft.exit_survey_enabled,
        department: draft.department,
        location_id: draft.location_id || null,
        shopify_tags: draft.shopify_tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        commission_rate: draft.commission_percent.trim()
          ? Number(draft.commission_percent) / 100
          : 0,
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
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RosterMetric
          label="Active team"
          value={loading ? "..." : activeCount}
          note={inactiveCount > 0 ? `${inactiveCount} inactive profile${inactiveCount === 1 ? "" : "s"}` : "Everyone is active"}
          tone="blue"
        />
        <RosterMetric
          label="Departments"
          value={loading ? "..." : activeDepartments}
          note="Across the active team"
          tone="violet"
        />
        <RosterMetric
          label="Locations"
          value={loading ? "..." : activeLocations}
          note="With active employees"
          tone="emerald"
        />
        <RosterMetric
          label="Birthdays on file"
          value={loading ? "..." : birthdaysOnFile}
          note={activeCount > 0 ? `${Math.round((birthdaysOnFile / activeCount) * 100)}% profile coverage` : "No active profiles"}
          tone="amber"
        />
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

      {loadError && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{loadError}</span>
          <button type="button" onClick={load} className="w-fit text-xs font-semibold text-red-700 hover:text-red-900">
            Try again
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Employee directory">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {loading ? "Loading directory" : `${filtered.length} employee${filtered.length === 1 ? "" : "s"}`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {hasActiveFilters ? "Results match your current filters" : "Select a profile to view or update it"}
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="w-fit rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 hover:text-blue-700"
            >
              Clear all filters
            </button>
          )}
        </div>

        <div className="hidden max-h-[calc(100vh-280px)] overflow-auto md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur">
              <tr className="border-b border-slate-100">
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
                    className="group cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[11px] font-semibold text-slate-600 transition group-hover:bg-blue-100 group-hover:text-blue-700" aria-hidden="true">
                          {employeeInitials(emp.name)}
                        </span>
                        <div className="min-w-0">
                          <button type="button" onClick={(event) => { event.stopPropagation(); startEdit(emp); }} className="block max-w-[250px] truncate text-left font-semibold text-slate-900 hover:text-blue-700">
                            {emp.name}
                          </button>
                          <div className="mt-0.5 max-w-[250px] truncate text-xs text-slate-400">
                            {emp.email ?? emp.email_alt ?? "No email on file"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          DEPT_COLORS[emp.department] ?? "border-slate-200 bg-slate-100 text-slate-600"
                        }`}
                      >
                        {DEPT_LABELS[emp.department] ?? emp.department}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-500">{emp.locations?.name ?? "Not assigned"}</td>
                    <td className={`px-4 py-3 text-xs ${emp.birthday ? "font-medium text-slate-500" : "text-slate-300"}`}>
                      {formatBirthday(emp.birthday)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          emp.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            emp.active ? "bg-emerald-500" : "bg-slate-400"
                          }`}
                          aria-hidden="true"
                        />
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-slate-100 md:hidden">
          {loading && <MobileSkeletonCards count={5} />}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-12">
              <EmptyState hasFilters={hasActiveFilters} onAdd={startAdd} onClearFilters={clearFilters} />
            </div>
          )}
          {!loading && filtered.map((emp) => (
            <button
              key={emp.id}
              type="button"
              onClick={() => startEdit(emp)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-600" aria-hidden="true">
                {employeeInitials(emp.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{emp.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${DEPT_COLORS[emp.department] ?? "border-slate-200 bg-slate-100 text-slate-600"}`}>
                    {DEPT_LABELS[emp.department] ?? emp.department}
                  </span>
                  <span className="text-[11px] text-slate-400">{emp.locations?.name ?? "No location"}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${emp.active ? "text-emerald-700" : "text-slate-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${emp.active ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
                  {emp.active ? "Active" : "Inactive"}
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 text-slate-300" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </section>

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
    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
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
    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 first:pl-5">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-slate-700 ${
          active ? "text-slate-700" : ""
        }`}
      >
        {label}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className={`h-3 w-3 ${active && dir === "desc" ? "rotate-180" : ""}`} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 9 3-3 3 3" />
        </svg>
      </button>
    </th>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100 last:border-0">
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
              <div>
                <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
                <div className="mt-1.5 h-3 w-40 rounded bg-slate-50 animate-pulse" />
              </div>
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-12 rounded bg-slate-100 animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-6 w-16 rounded-full bg-slate-100 animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  );
}

function MobileSkeletonCards({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4">
          <div className="h-10 w-10 rounded-xl bg-slate-100 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-40 rounded bg-slate-50 animate-pulse" />
          </div>
        </div>
      ))}
    </>
  );
}

function RosterMetric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  note: string;
  tone: "blue" | "violet" | "emerald" | "amber";
}) {
  const dotColor = {
    blue: "bg-blue-500",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} aria-hidden="true" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 truncate text-[11px] text-slate-400" title={note}>{note}</p>
    </div>
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
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" />
            <path strokeLinecap="round" d="m15 15 4 4" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-600">No employees match these filters</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-center">
      <p className="text-sm font-medium text-slate-600">Build your employee directory</p>
      <p className="text-xs text-slate-400">Add the first profile to get started.</p>
      <button
        type="button"
        onClick={onAdd}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
      >
        Add your first employee
      </button>
    </div>
  );
}
