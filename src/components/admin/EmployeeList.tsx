"use client";

import { useState, useEffect, useCallback } from "react";
import EmployeeForm from "./EmployeeForm";

interface Location {
  id: string;
  name: string;
  shopify_store_ids: string[];
}

interface Employee {
  id: string;
  name: string;
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

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!showInactive) params.set("active", "true");
      const res = await fetch(`/api/kpi/employees?${params}`);
      const data = await res.json();
      setEmployees(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

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
        <h2 className="text-xl font-serif font-semibold text-sand-900">
          Employees
        </h2>
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
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors"
          >
            + Add Employee
          </button>
        </div>
      </div>

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
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sand-400">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sand-400">
                    No employees found.
                  </td>
                </tr>
              )}
              {filtered.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-sand-900">
                    {emp.name}
                  </td>
                  <td className="px-4 py-3 text-sand-600">
                    {DEPT_LABELS[emp.department] ?? emp.department}
                  </td>
                  <td className="px-4 py-3 text-sand-500">
                    {emp.locations?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sand-400 font-mono text-xs">
                    {emp.shopify_tags?.length > 0
                      ? emp.shopify_tags.join(", ")
                      : "—"}
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
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setEditing(emp);
                        setShowForm(true);
                      }}
                      className="text-sm text-sand-500 hover:text-sand-900 mr-3 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(emp.id)}
                      disabled={deleting === emp.id}
                      className="text-sm text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      {deleting === emp.id ? "..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <EmployeeForm
          employee={editing}
          onSave={() => {
            setShowForm(false);
            setEditing(null);
            load();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
