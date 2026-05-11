"use client";

interface Location {
  id: string;
  name: string;
}

export type StatusFilter = "active" | "inactive" | "all";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  department: string;
  onDepartment: (v: string) => void;
  locationId: string;
  onLocation: (v: string) => void;
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  locations: Location[];
  departmentCounts: Record<string, number>;
  onAdd: () => void;
  addDisabled?: boolean;
}

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_service", label: "Customer Service" },
  { value: "warehouse", label: "Warehouse" },
  { value: "management", label: "Management" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

export default function EmployeeFilters({
  search,
  onSearch,
  department,
  onDepartment,
  locationId,
  onLocation,
  status,
  onStatus,
  locations,
  departmentCounts,
  onAdd,
  addDisabled,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search name or email…"
        className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 bg-white w-56 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      />

      <select
        value={department}
        onChange={(e) => onDepartment(e.target.value)}
        className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      >
        <option value="">All departments</option>
        {DEPARTMENTS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label} ({departmentCounts[d.value] ?? 0})
          </option>
        ))}
      </select>

      <select
        value={locationId}
        onChange={(e) => onLocation(e.target.value)}
        className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      >
        <option value="">All locations</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <div className="inline-flex rounded-lg border border-sand-200 bg-white overflow-hidden">
        {STATUS_OPTIONS.map((s, i) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onStatus(s.value)}
            className={`px-3 py-1.5 text-sm transition-colors ${
              status === s.value
                ? "bg-sand-900 text-sand-50"
                : "text-sand-600 hover:bg-sand-50"
            } ${i > 0 ? "border-l border-sand-200" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        onClick={onAdd}
        disabled={addDisabled}
        className="ml-auto px-4 py-1.5 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-40"
      >
        + Add Employee
      </button>
    </div>
  );
}
