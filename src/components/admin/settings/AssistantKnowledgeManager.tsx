"use client";

import { useMemo, useState } from "react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import {
  ASSISTANT_CATEGORIES,
  type AssistantCategory,
  type AssistantEvaluationCase,
  type AssistantKnowledgeEntry,
} from "@/lib/assistant-knowledge";

type Tab = "knowledge" | "tests";

interface KnowledgeDraft {
  id?: string;
  title: string;
  content: string;
  category: AssistantCategory;
  department: string;
  location: string;
  keywords: string;
  active: boolean;
}

interface EvaluationDraft {
  id?: string;
  question: string;
  expected_answer: string;
  department: string;
  location: string;
  active: boolean;
}

const EMPTY_KNOWLEDGE: KnowledgeDraft = {
  title: "",
  content: "",
  category: "company",
  department: "",
  location: "",
  keywords: "",
  active: true,
};

const EMPTY_EVALUATION: EvaluationDraft = {
  question: "",
  expected_answer: "",
  department: "",
  location: "",
  active: true,
};

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400";

const CATEGORY_LABELS: Record<AssistantCategory, string> = {
  company: "Company",
  invoices: "Invoices",
  expenses: "Expenses",
  time_off: "Time off",
  contacts: "Contacts",
  warehouse: "Warehouse",
  it: "IT",
  hr: "HR",
  other: "Other",
};

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.9 3.8 3.3 3.3M4.5 19.5l3.6-.7L19.5 7.4a1.8 1.8 0 0 0 0-2.6l-.3-.3a1.8 1.8 0 0 0-2.6 0L5.2 15.9l-.7 3.6Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5h15m-9-3h3m-7 3 .7 12h9.6l.7-12M9.5 11v5m5-5v5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 5.5v13l10-6.5L8 5.5Z" />
    </svg>
  );
}

function scopeLabel(department: string | null, location: string | null): string {
  const values = [department, location].filter(Boolean);
  return values.length ? values.join(" / ") : "Everyone";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  open,
  busy,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => !busy && onClose()}>
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            title="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AssistantKnowledgeManager({
  initialKnowledge,
  initialEvaluations,
  departments,
  locations,
}: {
  initialKnowledge: AssistantKnowledgeEntry[];
  initialEvaluations: AssistantEvaluationCase[];
  departments: string[];
  locations: string[];
}) {
  const [tab, setTab] = useState<Tab>("knowledge");
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [evaluations, setEvaluations] = useState(initialEvaluations);
  const [query, setQuery] = useState("");
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft | null>(null);
  const [evaluationDraft, setEvaluationDraft] = useState<EvaluationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: Tab;
    id: string;
    label: string;
  } | null>(null);

  const visibleKnowledge = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return knowledge;
    return knowledge.filter((entry) =>
      [entry.title, entry.content, entry.category, entry.department, entry.location, ...entry.keywords]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [knowledge, query]);

  async function reload() {
    const [knowledgeResponse, evaluationResponse] = await Promise.all([
      fetch("/api/settings/assistant-knowledge", { cache: "no-store" }),
      fetch("/api/settings/assistant-evaluations", { cache: "no-store" }),
    ]);
    const knowledgePayload = await knowledgeResponse.json();
    const evaluationPayload = await evaluationResponse.json();
    if (!knowledgeResponse.ok) throw new Error(knowledgePayload.error ?? "Could not reload knowledge");
    if (!evaluationResponse.ok) throw new Error(evaluationPayload.error ?? "Could not reload tests");
    setKnowledge(knowledgePayload.entries);
    setEvaluations(evaluationPayload.cases);
  }

  async function saveKnowledge(event: React.FormEvent) {
    event.preventDefault();
    if (!knowledgeDraft) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...knowledgeDraft,
          keywords: knowledgeDraft.keywords.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save knowledge");
      await reload();
      setKnowledgeDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save knowledge");
    } finally {
      setBusy(false);
    }
  }

  async function saveEvaluation(event: React.FormEvent) {
    event.preventDefault();
    if (!evaluationDraft) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evaluationDraft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save test");
      await reload();
      setEvaluationDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save test");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      const endpoint = deleteTarget.type === "knowledge"
        ? "/api/settings/assistant-knowledge"
        : "/api/settings/assistant-evaluations";
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not delete item");
      await reload();
      setDeleteTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete item");
    } finally {
      setBusy(false);
    }
  }

  async function runTests(id?: string) {
    setRunning(id ?? "all");
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-evaluations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not run tests");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run tests");
    } finally {
      setRunning(null);
    }
  }

  function editKnowledge(entry: AssistantKnowledgeEntry) {
    setKnowledgeDraft({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      department: entry.department ?? "",
      location: entry.location ?? "",
      keywords: entry.keywords.join(", "),
      active: entry.active,
    });
  }

  function editEvaluation(item: AssistantEvaluationCase) {
    setEvaluationDraft({
      id: item.id,
      question: item.question,
      expected_answer: item.expected_answer,
      department: item.department ?? "",
      location: item.location ?? "",
      active: item.active,
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Settings</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Assistant Knowledge</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{knowledge.filter((entry) => entry.active).length} active entries</span>
          <span className="text-slate-300">|</span>
          <span>{evaluations.filter((item) => item.active).length} active tests</span>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" title="Dismiss" className="shrink-0 text-rose-400 hover:text-rose-700">x</button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex h-9 self-start rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {(["knowledge", "tests"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-md px-3 text-xs font-semibold transition ${tab === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {value === "knowledge" ? "Knowledge" : "Tests"}
            </button>
          ))}
        </div>

        {tab === "knowledge" ? (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" />
              </svg>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search knowledge" aria-label="Search knowledge" className={`${INPUT_CLASS} h-9 pl-9`} />
            </div>
            <button type="button" onClick={() => setKnowledgeDraft({ ...EMPTY_KNOWLEDGE })} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
              <PlusIcon /> Add knowledge
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runTests()} disabled={running !== null || evaluations.every((item) => !item.active)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
              <PlayIcon /> {running === "all" ? "Running..." : "Run all"}
            </button>
            <button type="button" onClick={() => setEvaluationDraft({ ...EMPTY_EVALUATION })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
              <PlusIcon /> Add test
            </button>
          </div>
        )}
      </div>

      {tab === "knowledge" ? (
        visibleKnowledge.length === 0 ? (
          <div className="border-y border-slate-200 py-12 text-center text-sm text-slate-500">
            {knowledge.length === 0 ? "No approved knowledge yet." : "No entries match this search."}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleKnowledge.map((entry) => (
              <article key={entry.id} className={`rounded-lg border bg-white p-4 ${entry.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-sm font-semibold text-slate-900">{entry.title}</h2>
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">{CATEGORY_LABELS[entry.category]}</span>
                      {!entry.active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Inactive</span>}
                    </div>
                    <p className="mt-1 text-[11px] font-medium text-slate-400">{scopeLabel(entry.department, entry.location)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => editKnowledge(entry)} aria-label={`Edit ${entry.title}`} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><PencilIcon /></button>
                    <button type="button" onClick={() => setDeleteTarget({ type: "knowledge", id: entry.id, label: entry.title })} aria-label={`Delete ${entry.title}`} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><TrashIcon /></button>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-600">{entry.content}</p>
                {entry.keywords.length > 0 && <p className="mt-3 truncate text-[10px] text-slate-400">{entry.keywords.join(" | ")}</p>}
              </article>
            ))}
          </div>
        )
      ) : evaluations.length === 0 ? (
        <div className="border-y border-slate-200 py-12 text-center text-sm text-slate-500">No evaluation tests yet.</div>
      ) : (
        <div className="space-y-3">
          {evaluations.map((item) => (
            <article key={item.id} className={`rounded-lg border bg-white p-4 ${item.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-sm font-semibold text-slate-900">{item.question}</h2>
                    {!item.active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Inactive</span>}
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-slate-400">{scopeLabel(item.department, item.location)}</p>
                  <p className="mt-3 text-xs leading-5 text-slate-600"><span className="font-semibold text-slate-700">Expected: </span>{item.expected_answer}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                  <button type="button" onClick={() => void runTests(item.id)} disabled={running !== null} aria-label={`Run test ${item.question}`} title="Run test" className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"><PlayIcon /></button>
                  <button type="button" onClick={() => editEvaluation(item)} aria-label={`Edit test ${item.question}`} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><PencilIcon /></button>
                  <button type="button" onClick={() => setDeleteTarget({ type: "tests", id: item.id, label: item.question })} aria-label={`Delete test ${item.question}`} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><TrashIcon /></button>
                </div>
              </div>
              {item.latest_run && (
                <div className={`mt-3 border-l-2 pl-3 ${item.latest_run.passed ? "border-emerald-400" : "border-rose-400"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-semibold uppercase ${item.latest_run.passed ? "text-emerald-700" : "text-rose-700"}`}>{item.latest_run.passed ? "Passed" : "Failed"}</span>
                    <span className="text-[10px] text-slate-400">{formatTime(item.latest_run.created_at)}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600"><span className="font-semibold">Answer: </span>{item.latest_run.answer || "No answer returned"}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{item.latest_run.reason}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal title={knowledgeDraft?.id ? "Edit knowledge" : "Add knowledge"} open={knowledgeDraft !== null} busy={busy} onClose={() => setKnowledgeDraft(null)} onSubmit={saveKnowledge}>
        {knowledgeDraft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><input required maxLength={160} value={knowledgeDraft.title} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, title: event.target.value })} className={INPUT_CLASS} /></Field>
            <Field label="Category"><select value={knowledgeDraft.category} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, category: event.target.value as AssistantCategory })} className={INPUT_CLASS}>{ASSISTANT_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></Field>
            <Field label="Keywords"><input value={knowledgeDraft.keywords} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, keywords: event.target.value })} placeholder="vacation, holiday, absence" className={INPUT_CLASS} /></Field>
            <Field label="Department"><input list="assistant-departments" value={knowledgeDraft.department} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, department: event.target.value })} placeholder="All departments" className={INPUT_CLASS} /></Field>
            <Field label="Location"><input list="assistant-locations" value={knowledgeDraft.location} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, location: event.target.value })} placeholder="All locations" className={INPUT_CLASS} /></Field>
            <Field label="Approved answer" className="sm:col-span-2"><textarea required maxLength={8000} rows={8} value={knowledgeDraft.content} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, content: event.target.value })} className={`${INPUT_CLASS} resize-y leading-5`} /></Field>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" checked={knowledgeDraft.active} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, active: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-blue-600" />Active</label>
          </div>
        )}
      </Modal>

      <Modal title={evaluationDraft?.id ? "Edit test" : "Add test"} open={evaluationDraft !== null} busy={busy} onClose={() => setEvaluationDraft(null)} onSubmit={saveEvaluation}>
        {evaluationDraft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee question" className="sm:col-span-2"><textarea required maxLength={2000} rows={3} value={evaluationDraft.question} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, question: event.target.value })} className={`${INPUT_CLASS} resize-y`} /></Field>
            <Field label="Expected answer" className="sm:col-span-2"><textarea required maxLength={8000} rows={6} value={evaluationDraft.expected_answer} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, expected_answer: event.target.value })} className={`${INPUT_CLASS} resize-y`} /></Field>
            <Field label="Department"><input list="assistant-departments" value={evaluationDraft.department} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, department: event.target.value })} placeholder="Any department" className={INPUT_CLASS} /></Field>
            <Field label="Location"><input list="assistant-locations" value={evaluationDraft.location} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, location: event.target.value })} placeholder="Any location" className={INPUT_CLASS} /></Field>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" checked={evaluationDraft.active} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, active: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-blue-600" />Active</label>
          </div>
        )}
      </Modal>

      <datalist id="assistant-departments">{departments.map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="assistant-locations">{locations.map((value) => <option key={value} value={value} />)}</datalist>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.type === "knowledge" ? "Delete knowledge?" : "Delete test?"}
        message={deleteTarget ? `Delete "${deleteTarget.label}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        variant="destructive"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
