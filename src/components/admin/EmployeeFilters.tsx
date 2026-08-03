"use client";

interface Location {
  id: string;
  name: string;
}

export type StatusFilter = "active" | "inactive" | "all";

interface Props {
  search: string;
  onSearch: (value: string) => void;
  department: string;
  onDepartment: (value: string) => void;
  locationId: string;
  onLocation: (value: string) => void;
  status: StatusFilter;
  onStatus: (value: StatusFilter) => void;
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

const selectClass =
  "h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:text-sm";

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
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="employee-search" className="sr-only">Search employees</label>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true">
            <circle cx="10.75" cy="10.75" r="6.5" />
            <path strokeLinecap="round" d="m16 16 4 4" />
          </svg>
          <input
            id="employee-search"
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search by name or email"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
          />
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
          Add employee
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 lg:flex-row lg:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <label className="min-w-0">
            <span className="sr-only">Department</span>
            <select
              value={department}
              onChange={(event) => onDepartment(event.target.value)}
              className={`${selectClass} w-full sm:w-auto`}
            >
              <option value="">All departments</option>
              {DEPARTMENTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label} ({departmentCounts[item.value] ?? 0})
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0">
            <span className="sr-only">Location</span>
            <select
              value={locationId}
              onChange={(event) => onLocation(event.target.value)}
              className={`${selectClass} w-full sm:w-auto`}
            >
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="inline-flex h-10 rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Employee status">
          {STATUS_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={status === item.value}
              onClick={() => onStatus(item.value)}
              className={`flex-1 rounded-lg px-3 text-xs font-semibold transition sm:flex-none ${
                status === item.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-400 hover:text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
