"use client";

import { useState, useEffect } from "react";

interface Location {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
  department: string;
  location_id: string | null;
  shopify_tags: string[];
  active: boolean;
}

interface Props {
  employee?: Employee | null;
  onSave: () => void;
  onCancel: () => void;
}

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "customer_service", label: "Customer Service" },
  { value: "warehouse", label: "Warehouse" },
  { value: "management", label: "Management" },
];

export default function EmployeeForm({ employee, onSave, onCancel }: Props) {
  const [name, setName] = useState(employee?.name ?? "");
  const [department, setDepartment] = useState(employee?.department ?? "sales");
  const [locationId, setLocationId] = useState(employee?.location_id ?? "");
  const [shopifyTags, setShopifyTags] = useState(
    (employee?.shopify_tags ?? []).join(", ")
  );
  const [active, setActive] = useState(employee?.active ?? true);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/kpi/locations")
      .then((r) => r.json())
      .then((d) => setLocations(d))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError("");

    try {
      const body = {
        name: name.trim(),
        department,
        location_id: locationId || null,
        shopify_tags: shopifyTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        active,
      };

      const url = employee
        ? `/api/kpi/employees/${employee.id}`
        : "/api/kpi/employees";
      const method = employee ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-sand-200 shadow-lg w-full max-w-md p-6 space-y-4"
      >
        <h3 className="text-lg font-serif font-semibold text-sand-900">
          {employee ? "Edit Employee" : "Add Employee"}
        </h3>

        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            placeholder="Employee name"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Department
          </label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Location
          </label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">No location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Shopify Tags
            <span className="text-sand-400 font-normal ml-1">
              (comma-separated — all aliases that match order tags)
            </span>
          </label>
          <input
            type="text"
            value={shopifyTags}
            onChange={(e) => setShopifyTags(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            placeholder="e.g. Rob, rob, Robert, Robert Glas"
          />
          <p className="text-xs text-sand-400 mt-1">
            Matching is case-insensitive. Add all variations used in Shopify.
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="rounded border-sand-300 text-accent focus:ring-accent"
          />
          <span className="text-sm text-sand-700">Active</span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-sand-600 hover:text-sand-900 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : employee ? "Update" : "Add Employee"}
          </button>
        </div>
      </form>
    </div>
  );
}
