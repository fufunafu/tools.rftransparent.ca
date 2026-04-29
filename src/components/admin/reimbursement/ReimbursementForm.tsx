"use client";

import { useState } from "react";

const CATEGORIES = [
  "Gas",
  "Hotel",
  "Car Rental",
  "Flight",
  "Parking",
  "Meals",
  "Supplies",
  "Tools",
  "Software",
  "Shipping",
  "Other",
] as const;

interface Props {
  onSubmitted: (id: number) => void;
}

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export default function ReimbursementForm({ onSubmitted }: Props) {
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Supplies");
  const [otherCategory, setOtherCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (!vendor.trim()) {
      setError("Vendor is required.");
      return;
    }
    if (category === "Other" && !otherCategory.trim()) {
      setError("Please specify the category for 'Other'.");
      return;
    }

    // For "Other" we store what the user typed as the category, so the saved
    // value is meaningful instead of a literal "Other".
    const finalCategory = category === "Other" ? `Other — ${otherCategory.trim()}` : category;

    setSubmitting(true);
    try {
      const res = await fetch("/api/accounting/reimbursement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_date: expenseDate,
          amount: amt,
          vendor: vendor.trim(),
          category: finalCategory,
          description: description.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Submission failed");
      onSubmitted(body.request.id);
      // Reset everything except the date.
      setAmount("");
      setVendor("");
      setDescription("");
      setCategory("Supplies");
      setOtherCategory("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-sand-200/60 p-5 space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-sand-900">New reimbursement request</h3>
        <p className="text-xs text-sand-500 mt-1">
          Receipt photos must be emailed separately to{" "}
          <a className="text-blue-600" href="mailto:finance@glass-railing.com">
            finance@glass-railing.com
          </a>{" "}
          referencing the request number you receive after submitting.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-sand-600">Expense date</span>
          <input
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-sand-600">Amount (CAD)</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-sand-600">Vendor</span>
          <input
            type="text"
            required
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Home Depot, Uber, …"
            className="mt-1 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-sand-600">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
            className="mt-1 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        {category === "Other" && (
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-sand-600">Specify category</span>
            <input
              type="text"
              required
              value={otherCategory}
              onChange={(e) => setOtherCategory(e.target.value)}
              placeholder="What kind of expense is this?"
              className="mt-1 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-sand-600">Description</span>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this for?"
          className="mt-1 w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </label>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
