"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  created_by: string;
  created_by_name: string;
  created_at: string;
  due_at: string | null;
}

type Filter = "all" | "today" | "overdue" | "upcoming" | "completed";
type Scope = "mine" | "all";

function todayISO(): string {
  // Local-time YYYY-MM-DD so "today" matches what the user sees on the wall clock,
  // not the UTC server day.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDueLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  // YYYY-MM-DD lexicographic compare matches calendar order.
  const date = new Date(iso + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TodoList({ canSeeAll = false }: { canSeeAll?: boolean }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>("mine");

  const today = useMemo(() => todayISO(), []);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/todos${scope === "all" ? "?scope=all" : ""}`, { cache: "no-store" });
      if (res.ok) setTodos(await res.json());
      else setTodos([]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

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
        body: JSON.stringify({ title, due_at: dueAt || null }),
      });
      if (res.ok) {
        const todo: Todo = await res.json();
        setTodos((prev) => [todo, ...prev]);
        setTitle("");
        setDueAt("");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(todo: Todo) {
    const updated = { ...todo, completed: !todo.completed };
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)));
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

  // Bucket helpers — single source of truth for the filter chips and the list.
  const inBucket = useCallback(
    (t: Todo, f: Filter): boolean => {
      if (f === "completed") return t.completed;
      if (t.completed) return false;
      if (f === "all") return true;
      if (!t.due_at) return false; // dated buckets exclude no-date tasks
      if (f === "today") return t.due_at === today;
      if (f === "overdue") return t.due_at < today;
      if (f === "upcoming") return t.due_at > today;
      return false;
    },
    [today],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, today: 0, overdue: 0, upcoming: 0, completed: 0 };
    for (const t of todos) {
      for (const f of ["all", "today", "overdue", "upcoming", "completed"] as Filter[]) {
        if (inBucket(t, f)) c[f]++;
      }
    }
    return c;
  }, [todos, inBucket]);

  const filtered = todos.filter((t) => inBucket(t, filter));

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">
        Loading...
      </div>
    );
  }

  const FILTERS: { key: Filter; label: string; showCountIf?: (n: number) => boolean }[] = [
    { key: "all", label: "All" },
    { key: "today", label: "Today", showCountIf: (n) => n > 0 },
    { key: "overdue", label: "Overdue", showCountIf: (n) => n > 0 },
    { key: "upcoming", label: "Upcoming" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500 mt-1">
            {scope === "all" && "Team: "}
            {counts.all} active{counts.completed > 0 && `, ${counts.completed} completed`}
          </p>
        </div>
        {canSeeAll && (
          <div className="flex gap-1">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  scope === s
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s === "mine" ? "My tasks" : "All tasks"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        className="bg-white rounded-xl border border-slate-200 p-4"
      >
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            min={today}
            title="Due date (optional)"
            className="w-44 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit flex-wrap">
        {FILTERS.map(({ key, label, showCountIf }) => {
          const n = counts[key];
          const showCount = showCountIf ? showCountIf(n) : false;
          const accent = key === "overdue" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600";
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === key ? accent : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
              {showCount && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    key === "overdue" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Task list */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            {filter === "all"
              ? "No tasks yet. Add one above!"
              : `No ${filter} tasks.`}
          </div>
        ) : (
          filtered.map((todo) => {
            const overdue = !todo.completed && todo.due_at && todo.due_at < today;
            const dueToday = !todo.completed && todo.due_at === today;
            return (
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
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {scope === "all" && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-medium">
                        {todo.created_by_name}
                      </span>
                    )}
                    {todo.due_at && (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
                          overdue
                            ? "bg-red-50 text-red-600"
                            : dueToday
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {overdue ? "Overdue · " : ""}
                        {formatDueLabel(todo.due_at, today)}
                      </span>
                    )}
                    <span>
                      Added{" "}
                      {new Date(todo.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
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
            );
          })
        )}
      </div>
    </div>
  );
}
