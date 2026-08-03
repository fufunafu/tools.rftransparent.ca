"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Active" },
  { key: "today", label: "Today" },
  { key: "overdue", label: "Overdue" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
];

function toLocalISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayISO(): string {
  return toLocalISO(new Date());
}

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalISO(date);
}

function formatDueLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, 1)) return "Tomorrow";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Recently added";
  return `Added ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return typeof data.error === "string" ? data.error : fallback;
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.25 4.25L19 7" />
    </svg>
  );
}

function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="3.5" y="5.25" width="17" height="15" rx="2.5" />
      <path strokeLinecap="round" d="M8 3.5v3.25M16 3.5v3.25M3.75 9.5h16.5" />
    </svg>
  );
}

function TasksIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m7.5 9 1.5 1.5L11.5 8M13.5 9.25h3M7.5 15l1.5 1.5 2.5-2.5M13.5 15.25h3" />
    </svg>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  note: string;
  tone: "blue" | "amber" | "red" | "green";
}) {
  const dotColor = {
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    green: "bg-emerald-500",
  }[tone];

  return (
    <div className="border-t border-slate-200/80 px-5 py-4 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const copy: Record<Filter, { title: string; description: string }> = {
    all: { title: "Your list is clear", description: "Add a task above when something needs your attention." },
    today: { title: "Nothing due today", description: "You have room to focus on what matters most." },
    overdue: { title: "Nothing overdue", description: "Everything is currently on track." },
    upcoming: { title: "No upcoming deadlines", description: "Future dated tasks will appear here." },
    completed: { title: "No completed tasks yet", description: "Finished work will collect here." },
  };

  return (
    <div className="px-5 py-14 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        {filter === "completed" ? <CheckIcon className="h-5 w-5" /> : <TasksIcon />}
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-700">{copy[filter].title}</p>
      <p className="mt-1 text-xs text-slate-400">{copy[filter].description}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4 sm:px-5">
          <div className="h-6 w-6 animate-pulse rounded-lg bg-slate-100" />
          <div className="flex-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
            <div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-50" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TodoList({ canSeeAll = false }: { canSeeAll?: boolean }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>("mine");
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const today = useMemo(() => todayISO(), []);
  const tomorrow = useMemo(() => addDaysISO(today, 1), [today]);
  const nextWeek = useMemo(() => addDaysISO(today, 7), [today]);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/todos${scope === "all" ? "?scope=all" : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not load tasks."));
      const data = await response.json();
      setTodos(Array.isArray(data) ? data : []);
    } catch (err) {
      setTodos([]);
      setError(err instanceof Error ? err.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setAdding(true);
    setError("");
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, due_at: dueAt || null }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not add the task."));
      const todo: Todo = await response.json();
      setTodos((current) => [todo, ...current]);
      setTitle("");
      setDueAt("");
      setFilter("all");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task.");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(todo: Todo) {
    if (updatingId) return;
    const previous = todos;
    const updated = { ...todo, completed: !todo.completed };
    setUpdatingId(todo.id);
    setError("");
    setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    try {
      const response = await fetch("/api/todos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: todo.id, completed: updated.completed }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not update the task."));
    } catch (err) {
      setTodos(previous);
      setError(err instanceof Error ? err.message : "Could not update the task.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (deletingId) return;
    const previous = todos;
    setDeletingId(id);
    setError("");
    setTodos((current) => current.filter((todo) => todo.id !== id));
    try {
      const response = await fetch(`/api/todos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Could not delete the task."));
      setConfirmingDelete(null);
    } catch (err) {
      setTodos(previous);
      setError(err instanceof Error ? err.message : "Could not delete the task.");
    } finally {
      setDeletingId(null);
    }
  }

  const inBucket = useCallback(
    (todo: Todo, bucket: Filter): boolean => {
      if (bucket === "completed") return todo.completed;
      if (todo.completed) return false;
      if (bucket === "all") return true;
      if (!todo.due_at) return false;
      if (bucket === "today") return todo.due_at === today;
      if (bucket === "overdue") return todo.due_at < today;
      if (bucket === "upcoming") return todo.due_at > today;
      return false;
    },
    [today],
  );

  const counts = useMemo(() => {
    const current: Record<Filter, number> = {
      all: 0,
      today: 0,
      overdue: 0,
      upcoming: 0,
      completed: 0,
    };
    for (const todo of todos) {
      for (const bucket of FILTERS) {
        if (inBucket(todo, bucket.key)) current[bucket.key] += 1;
      }
    }
    return current;
  }, [todos, inBucket]);

  const filtered = useMemo(() => todos.filter((todo) => inBucket(todo, filter)), [todos, filter, inBucket]);
  const totalTracked = counts.all + counts.completed;
  const completionRate = totalTracked > 0 ? Math.round((counts.completed / totalTracked) * 100) : 0;
  const currentFilter = FILTERS.find((item) => item.key === filter)?.label ?? "Tasks";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
          <div className="absolute right-0 top-0 h-48 w-48 translate-x-14 -translate-y-16 rounded-full bg-blue-100/70 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">
                <TasksIcon className="h-4 w-4" />
                Focus
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">Tasks</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Capture what matters, keep deadlines visible, and close the loop on your work.
              </p>
            </div>
            {canSeeAll && (
              <div className="inline-flex h-11 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Task scope">
                {(["mine", "all"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={scope === item}
                    disabled={loading}
                    onClick={() => setScope(item)}
                    className={`rounded-lg px-3 text-xs font-semibold transition sm:px-4 ${
                      scope === item
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-400 hover:text-slate-700"
                    }`}
                  >
                    {item === "mine" ? "My tasks" : "Team tasks"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid bg-slate-50/70 sm:grid-cols-4 sm:border-t sm:border-slate-200">
          <Metric label="Active" value={loading ? "..." : counts.all} note={scope === "all" ? "Across the team" : "On your list"} tone="blue" />
          <Metric label="Due today" value={loading ? "..." : counts.today} note="Needs attention now" tone="amber" />
          <Metric label="Overdue" value={loading ? "..." : counts.overdue} note={counts.overdue > 0 ? "Past the due date" : "Nothing behind"} tone="red" />
          <Metric label="Completed" value={loading ? "..." : counts.completed} note={`${completionRate}% of tracked work`} tone="green" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Add a task</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {scope === "all" ? "New tasks are added to your personal list." : "Add a due date now or leave it open-ended."}
            </p>
          </div>
        </div>

        <form onSubmit={handleAdd}>
          <div className="flex flex-col gap-2.5 lg:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Task title</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs to be done?"
                maxLength={500}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              />
            </label>
            <label className="relative lg:w-48">
              <span className="sr-only">Due date</span>
              <CalendarIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                min={today}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-600 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            </label>
            <button
              type="submit"
              disabled={adding || !title.trim()}
              className="h-11 shrink-0 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {adding ? "Adding..." : "Add task"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium text-slate-400">Quick due date</span>
            {[
              { label: "Today", value: today },
              { label: "Tomorrow", value: tomorrow },
              { label: "Next week", value: nextWeek },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={dueAt === option.value}
                onClick={() => setDueAt(option.value)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  dueAt === option.value
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
            {dueAt && (
              <button type="button" onClick={() => setDueAt("")} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                Clear date
              </button>
            )}
          </div>
        </form>
      </section>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={fetchTodos} className="w-fit text-xs font-semibold text-red-700 hover:text-red-900">
            Refresh tasks
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" aria-label="Task filters">
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
          {FILTERS.map((item) => {
            const selected = filter === item.key;
            const urgent = item.key === "overdue" && counts.overdue > 0;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(item.key)}
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition sm:text-sm ${
                  selected
                    ? urgent
                      ? "bg-red-50 text-red-700"
                      : "bg-slate-950 text-white shadow-sm"
                    : "text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                {item.label}
                {counts[item.key] > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${selected ? urgent ? "bg-red-100 text-red-700" : "bg-white/15 text-white" : urgent ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                    {counts[item.key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={`${currentFilter} tasks`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{currentFilter} tasks</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {loading ? "Loading your list" : `${filtered.length} task${filtered.length === 1 ? "" : "s"} in this view`}
            </p>
          </div>
          {scope === "all" && (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">
              Team view
            </span>
          )}
        </div>

        {loading ? (
          <LoadingRows />
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((todo) => {
              const overdue = Boolean(!todo.completed && todo.due_at && todo.due_at < today);
              const dueToday = !todo.completed && todo.due_at === today;
              const confirming = confirmingDelete === todo.id;
              const updating = updatingId === todo.id;
              return (
                <article key={todo.id} className={`group transition ${todo.completed ? "bg-slate-50/50" : "bg-white hover:bg-slate-50/50"}`}>
                  <div className="flex items-start gap-3 px-4 py-4 sm:items-center sm:px-5">
                    <button
                      type="button"
                      onClick={() => handleToggle(todo)}
                      disabled={Boolean(updatingId)}
                      aria-label={todo.completed ? `Mark ${todo.title} active` : `Mark ${todo.title} completed`}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition sm:mt-0 ${
                        todo.completed
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-slate-300 bg-white text-transparent hover:border-blue-500 hover:text-blue-500"
                      } ${updating ? "animate-pulse" : ""}`}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className={`text-sm leading-5 ${todo.completed ? "text-slate-400 line-through" : "font-medium text-slate-900"}`}>
                        {todo.title}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        {scope === "all" && (
                          <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">
                            {todo.created_by_name}
                          </span>
                        )}
                        {todo.due_at && (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                            overdue
                              ? "bg-red-50 text-red-700"
                              : dueToday
                                ? "bg-amber-50 text-amber-700"
                                : "bg-blue-50 text-blue-700"
                          }`}>
                            <CalendarIcon className="h-3 w-3" />
                            {overdue ? `Overdue, ${formatDueLabel(todo.due_at, today)}` : formatDueLabel(todo.due_at, today)}
                          </span>
                        )}
                        <span>{formatCreatedAt(todo.created_at)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(confirming ? null : todo.id)}
                      aria-label={`Delete ${todo.title}`}
                      aria-expanded={confirming}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${confirming ? "bg-red-50 text-red-600 opacity-100" : ""}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7h15M9.5 11v5M14.5 11v5M6.5 7l.75 12h9.5l.75-12M9 7V4.75h6V7" />
                      </svg>
                    </button>
                  </div>

                  {confirming && (
                    <div className="flex flex-col gap-3 border-t border-red-100 bg-red-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <p className="text-xs font-medium text-red-700">Delete this task permanently?</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setConfirmingDelete(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white">
                          Keep task
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(todo.id)}
                          disabled={deletingId === todo.id}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                          {deletingId === todo.id ? "Deleting..." : "Delete task"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
