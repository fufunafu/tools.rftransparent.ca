"use client";

import { useState, useEffect } from "react";

interface Employee {
  id: string;
  name: string;
  department: string;
}

interface Props {
  onSave: () => void;
  onCancel: () => void;
}

const METRIC_SUGGESTIONS: Record<string, string[]> = {
  customer_service: ["tickets_resolved", "response_time", "satisfaction"],
};

export default function KPIEntryForm({ onSave, onCancel }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [metric, setMetric] = useState("");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only load employees with manual KPIs (exclude sales + warehouse which are auto-calculated)
    fetch("/api/kpi/employees?active=true")
      .then((r) => r.json())
      .then((data) =>
        setEmployees(
          data.filter(
            (e: Employee) => e.department !== "sales" && e.department !== "warehouse" && e.department !== "marketing"
          )
        )
      )
      .catch(() => {});
  }, []);

  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const suggestions = selectedEmployee
    ? METRIC_SUGGESTIONS[selectedEmployee.department] ?? []
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !metric.trim() || !value) return;

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/kpi/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          metric: metric.trim(),
          value: parseFloat(value),
          date,
        }),
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
          Add KPI Entry
        </h3>
        <p className="text-xs text-sand-400">
          For manual departments. Sales &amp; Warehouse KPIs come from Shopify, Marketing from Google Ads.
        </p>

        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Employee
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">Select employee...</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.department.replace("_", " ")})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Metric
          </label>
          <input
            type="text"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            placeholder="e.g. tickets_resolved"
          />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setMetric(s)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    metric === s
                      ? "bg-sand-900 text-sand-50 border-sand-900"
                      : "bg-sand-50 text-sand-600 border-sand-200 hover:border-sand-400"
                  }`}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-1">
              Value
            </label>
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

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
            disabled={saving || !employeeId || !metric.trim() || !value}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Add Entry"}
          </button>
        </div>
      </form>
    </div>
  );
}
