"use client";

import { useEffect, useState } from "react";
import type { Category } from "@/lib/purchasing/types";

interface Props {
  defaultCategory?: Category;
  onClose: () => void;
  onCreated: () => void;
}

export default function AddProductDialog({
  defaultCategory = "glass", onClose, onCreated,
}: Props) {
  const [category, setCategory] = useState<Category>(defaultCategory);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [height, setHeight] = useState("");
  const [width, setWidth] = useState("");
  const [storageCapacity, setStorageCapacity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [currentInventory, setCurrentInventory] = useState("0");
  const [grs, setGrs] = useState("0");
  const [rf, setRf] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim()) {
      setError("SKU and Name are required."); return;
    }
    setSaving(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        category, sku: sku.trim(), name: name.trim(),
        storage_capacity: parseFloat(storageCapacity) || 0,
        unit_cost_landed: parseFloat(unitCost) || 0,
        current_inventory: parseFloat(currentInventory) || 0,
        avg_monthly_sales_grs: parseFloat(grs) || 0,
        avg_monthly_sales_rf: parseFloat(rf) || 0,
      };
      if (height.trim()) payload.height = parseFloat(height);
      if (width.trim()) payload.width = parseFloat(width);
      const res = await fetch("/api/purchasing/products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create product");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-sand-200/60 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-sand-900">New product</h2>
          <button type="button" onClick={onClose} className="text-sand-500 hover:text-sand-900 text-sm">Close ✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full px-3 py-2 rounded-lg border border-sand-300 bg-white">
                <option value="glass">Glass</option>
                <option value="hardware">Hardware</option>
              </select>
            </Field>
            <Field label="SKU *">
              <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. GP40X45.3"
                className="w-full px-3 py-2 rounded-lg border border-sand-300 font-mono" autoFocus />
            </Field>
          </div>
          <Field label="Name *">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder='e.g. 40"x45.3" Tempered Glass'
              className="w-full px-3 py-2 rounded-lg border border-sand-300" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Height (in)"><input type="number" step="any" value={height} onChange={(e) => setHeight(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
            <Field label="Width (in)"><input type="number" step="any" value={width} onChange={(e) => setWidth(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Storage capacity (units)"><input type="number" step="any" min="0" value={storageCapacity}
              onChange={(e) => setStorageCapacity(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
            <Field label="Unit cost (CAD, landed)"><input type="number" step="0.01" min="0" value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="On hand"><input type="number" step="any" min="0" value={currentInventory}
              onChange={(e) => setCurrentInventory(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
            <Field label="Avg monthly GRS"><input type="number" step="any" min="0" value={grs}
              onChange={(e) => setGrs(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
            <Field label="Avg monthly RF"><input type="number" step="any" min="0" value={rf}
              onChange={(e) => setRf(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-sand-300" /></Field>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-sand-200/60 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300">
            {saving ? "Saving…" : "Create product"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-[11px] text-sand-400 uppercase tracking-wider font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}
