"use client";

import { useEffect, useState } from "react";

interface HomeSection {
  id: string;
  type: "focus" | "venture";
  title: string;
  description: string;
  display_order: number;
}

interface EditingState {
  title: string;
  description: string;
  display_order: number;
}

export default function HomeSectionEditor() {
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, EditingState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<"focus" | "venture" | null>(null);
  const [newItem, setNewItem] = useState({ title: "", description: "", display_order: 0 });
  const [addingLoading, setAddingLoading] = useState(false);

  useEffect(() => {
    fetch("/api/content/home")
      .then((r) => r.json())
      .then(setSections)
      .finally(() => setLoading(false));
  }, []);

  function startEdit(s: HomeSection) {
    setEditing((prev) => ({
      ...prev,
      [s.id]: { title: s.title, description: s.description, display_order: s.display_order },
    }));
  }

  function cancelEdit(id: string) {
    setEditing((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  async function saveEdit(id: string) {
    setSavingId(id);
    const body = editing[id];
    const res = await fetch(`/api/content/home?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const updated = await res.json();
      setSections((prev) => prev.map((s) => s.id === id ? { ...s, ...updated } : s));
      cancelEdit(id);
    }
    setSavingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this section?")) return;
    setDeletingId(id);
    await fetch(`/api/content/home?id=${id}`, { method: "DELETE" });
    setSections((prev) => prev.filter((s) => s.id !== id));
    setDeletingId(null);
  }

  async function handleAdd() {
    if (!adding || !newItem.title) return;
    setAddingLoading(true);
    const res = await fetch("/api/content/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: adding, ...newItem }),
    });
    if (res.ok) {
      const created = await res.json();
      setSections((prev) => [...prev, created].sort((a, b) => a.display_order - b.display_order));
      setAdding(null);
      setNewItem({ title: "", description: "", display_order: 0 });
    }
    setAddingLoading(false);
  }

  const focus = sections.filter((s) => s.type === "focus");
  const ventures = sections.filter((s) => s.type === "venture");

  if (loading) return <p className="text-sm text-sand-400">Loading...</p>;

  function SectionGroup({ type, items, label }: { type: "focus" | "venture"; items: HomeSection[]; label: string }) {
    return (
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-sand-700 uppercase tracking-widest">{label}</h2>
          <button
            onClick={() => { setAdding(type); setNewItem({ title: "", description: "", display_order: items.length }); }}
            className="text-xs px-3 py-1.5 text-accent border border-accent/30 rounded-lg hover:bg-accent/5 transition-colors"
          >
            + Add
          </button>
        </div>

        {items.length === 0 && !adding && (
          <p className="text-sm text-sand-400 italic">No {label.toLowerCase()} yet.</p>
        )}

        <div className="space-y-3">
          {items.map((s) => {
            const isEditing = !!editing[s.id];
            const e = editing[s.id];
            return (
              <div key={s.id} className="bg-white rounded-xl border border-sand-200/60 p-5">
                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      value={e.title}
                      onChange={(ev) => setEditing((prev) => ({ ...prev, [s.id]: { ...prev[s.id], title: ev.target.value } }))}
                      placeholder="Title"
                      className="w-full text-sm border border-sand-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <textarea
                      value={e.description}
                      onChange={(ev) => setEditing((prev) => ({ ...prev, [s.id]: { ...prev[s.id], description: ev.target.value } }))}
                      placeholder="Description"
                      rows={3}
                      className="w-full text-sm border border-sand-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        value={e.display_order}
                        onChange={(ev) => setEditing((prev) => ({ ...prev, [s.id]: { ...prev[s.id], display_order: Number(ev.target.value) } }))}
                        className="w-20 text-sm border border-sand-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                      <span className="text-xs text-sand-400">display order</span>
                      <button
                        onClick={() => saveEdit(s.id)}
                        disabled={savingId === s.id}
                        className="ml-auto px-4 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50"
                      >
                        {savingId === s.id ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => cancelEdit(s.id)} className="text-xs text-sand-500 hover:text-sand-900">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-sand-900">{s.title}</p>
                      <p className="text-sm text-sand-500 mt-0.5">{s.description || <span className="italic text-sand-300">No description</span>}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => startEdit(s)} className="text-xs px-3 py-1.5 border border-sand-200 rounded-lg text-sand-600 hover:bg-sand-50 transition-colors">
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {deletingId === s.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {adding === type && (
            <div className="bg-white rounded-xl border border-accent/30 p-5 space-y-3">
              <p className="text-xs font-medium text-accent uppercase tracking-widest">New {label.slice(0, -1)}</p>
              <input
                value={newItem.title}
                onChange={(e) => setNewItem((p) => ({ ...p, title: e.target.value }))}
                placeholder="Title"
                className="w-full text-sm border border-sand-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <textarea
                value={newItem.description}
                onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))}
                placeholder="Description"
                rows={3}
                className="w-full text-sm border border-sand-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAdd}
                  disabled={addingLoading || !newItem.title}
                  className="px-4 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50"
                >
                  {addingLoading ? "Adding…" : "Add"}
                </button>
                <button onClick={() => setAdding(null)} className="text-xs text-sand-500 hover:text-sand-900">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionGroup type="focus" items={focus} label="Current Focus" />
      <SectionGroup type="venture" items={ventures} label="Ventures" />
    </div>
  );
}
