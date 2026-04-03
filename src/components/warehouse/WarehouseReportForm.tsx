"use client";

import { useState, useEffect, useCallback } from "react";

interface Employee {
  id: string;
  name: string;
}

interface Report {
  id: string;
  employee_id: string;
  report_date: string;
  boxes_built: number;
  orders_packed: number;
  boxes_closed: number;
  shipments_booked: number;
  notes: string | null;
  updated_at: string;
}

const STORAGE_KEY = "warehouse_report_employee_id";

export default function WarehouseReportForm() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [boxesBuilt, setBoxesBuilt] = useState("");
  const [ordersPacked, setOrdersPacked] = useState("");
  const [boxesClosed, setBoxesClosed] = useState("");
  const [shipmentsBooked, setShipmentsBooked] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [existingReport, setExistingReport] = useState<Report | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Load warehouse employees
  useEffect(() => {
    fetch("/api/warehouse/employees")
      .then((r) => r.json())
      .then((data: Employee[]) => {
        setEmployees(data);
        // Restore last-used employee from localStorage
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && data.some((e) => e.id === stored)) {
          setEmployeeId(stored);
        }
      })
      .catch(() => setError("Failed to load employees"));
  }, []);

  // Fetch existing report when employee or date changes
  const loadExisting = useCallback(async () => {
    if (!employeeId || !date) return;
    setLoadingReport(true);
    try {
      const res = await fetch(
        `/api/warehouse/reports?employeeId=${employeeId}&from=${date}&to=${date}`
      );
      if (!res.ok) return;
      const data: Report[] = await res.json();
      if (data.length > 0) {
        const r = data[0];
        setExistingReport(r);
        setBoxesBuilt(String(r.boxes_built));
        setOrdersPacked(String(r.orders_packed));
        setBoxesClosed(String(r.boxes_closed));
        setShipmentsBooked(String(r.shipments_booked));
        setNotes(r.notes || "");
      } else {
        setExistingReport(null);
        setBoxesBuilt("");
        setOrdersPacked("");
        setBoxesClosed("");
        setShipmentsBooked("");
        setNotes("");
      }
    } catch {
      // Ignore — form still works for new entries
    } finally {
      setLoadingReport(false);
    }
  }, [employeeId, date]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  const handleEmployeeChange = (id: string) => {
    setEmployeeId(id);
    setSuccess("");
    if (id) localStorage.setItem(STORAGE_KEY, id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/warehouse/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          report_date: date,
          boxes_built: parseInt(boxesBuilt) || 0,
          orders_packed: parseInt(ordersPacked) || 0,
          boxes_closed: parseInt(boxesClosed) || 0,
          shipments_booked: parseInt(shipmentsBooked) || 0,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const saved = await res.json();
      setExistingReport(saved);
      setSuccess(
        existingReport ? "Report updated!" : "Report submitted!"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const employeeName = employees.find((e) => e.id === employeeId)?.name;

  return (
    <div className="min-h-screen bg-sand-50 flex items-start justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-sand-200 shadow-sm w-full max-w-md p-6 space-y-5"
      >
        <div>
          <h1 className="text-lg font-semibold text-sand-900">
            Daily Warehouse Report
          </h1>
          <p className="text-xs text-sand-400 mt-1">
            Fill in your daily output for each step.
          </p>
        </div>

        {/* Employee */}
        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Your Name
          </label>
          <select
            value={employeeId}
            onChange={(e) => handleEmployeeChange(e.target.value)}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 bg-white focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">Select your name...</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSuccess("");
            }}
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        {loadingReport && employeeId && (
          <p className="text-xs text-sand-400">Checking for existing report...</p>
        )}

        {existingReport && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
            Editing existing report &mdash; last updated{" "}
            {new Date(existingReport.updated_at).toLocaleString()}
          </div>
        )}

        {/* Step counts */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-1">
              Boxes Built
            </label>
            <input
              type="number"
              min="0"
              value={boxesBuilt}
              onChange={(e) => setBoxesBuilt(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-1">
              Orders Packed
            </label>
            <input
              type="number"
              min="0"
              value={ordersPacked}
              onChange={(e) => setOrdersPacked(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-1">
              Boxes Closed
            </label>
            <input
              type="number"
              min="0"
              value={boxesClosed}
              onChange={(e) => setBoxesClosed(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sand-700 mb-1">
              Shipments Booked
            </label>
            <input
              type="number"
              min="0"
              value={shipmentsBooked}
              onChange={(e) => setShipmentsBooked(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-sand-700 mb-1">
            Notes <span className="text-sand-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything to note about today..."
            className="w-full rounded-lg border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !employeeId}
          className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : existingReport
              ? "Update Report"
              : "Submit Report"}
        </button>

        {employeeName && (
          <p className="text-xs text-sand-400 text-center">
            Submitting as {employeeName}
          </p>
        )}
      </form>
    </div>
  );
}
