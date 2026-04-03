"use client";

import { useState, useEffect, useCallback } from "react";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  created_by: string;
  created_at: string;
}

type Filter = "all" | "active" | "completed";

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch("/api/todos");
      if (res.ok) setTodos(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, created_by: createdBy }),
      });
      if (res.ok) {
        const todo = await res.json();
        setTodos((prev) => [todo, ...prev]);
        setTitle("");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(todo: Todo) {
    const updated = { ...todo, completed: !todo.completed };
    setTodos((prev) =>
      prev.map((t) => (t.id === todo.id ? updated : t))
    );
    await fetch("/api/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: todo.id, completed: !todo.completed }),
    });
  }

  async function handleDelete(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/todos?id=${id}`, { method: "DELETE" });
  }

  const filtered = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">To-Do List</h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeCount} active{completedCount > 0 && `, ${completedCount} completed`}
          </p>
        </div>
      </div>

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="bg-white rounded-xl border border-slate-200 p-4"
      >
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            type="text"
            placeholder="Your name"
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            className="w-40 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={adding || !title.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
      </form>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit">
        {(["all", "active", "completed"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? "bg-blue-50 text-blue-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "active" && activeCount > 0 && (
              <span className="ml-1.5 text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Todo list */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            {filter === "all"
              ? "No to-dos yet. Add one above!"
              : `No ${filter} to-dos.`}
          </div>
        ) : (
          filtered.map((todo) => (
            <div
              key={todo.id}
              className="flex items-center gap-3 px-4 py-3 group"
            >
              <button
                onClick={() => handleToggle(todo)}
                className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  todo.completed
                    ? "bg-green-500 border-green-500"
                    : "border-slate-300 hover:border-blue-400"
                }`}
              >
                {todo.completed && (
                  <svg viewBox="0 0 12 12" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </button>

              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm ${
                    todo.completed
                      ? "line-through text-slate-400"
                      : "text-slate-900"
                  }`}
                >
                  {todo.title}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {todo.created_by} &middot;{" "}
                  {new Date(todo.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>

              <button
                onClick={() => handleDelete(todo.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                title="Delete"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
