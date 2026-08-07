"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import {
  ASSISTANT_CATEGORIES,
  ASSISTANT_INITIAL_PROMPT_MAX_LENGTH,
  ASSISTANT_KNOWLEDGE_SOURCE_MAX_LENGTH,
  type AssistantCategory,
  type AssistantEvaluationCase,
  type AssistantKnowledgeEntry,
  type AssistantKnowledgeGap,
} from "@/lib/assistant-knowledge";
import type { AssistantPromptVersion } from "@/lib/assistant-prompt-versions";

type Tab = "prompt" | "knowledge" | "gaps" | "tests";
type CollectionTab = "knowledge" | "tests";

interface KnowledgeDraft {
  id?: string;
  title: string;
  content: string;
  category: AssistantCategory;
  department: string;
  location: string;
  keywords: string;
  source_id?: string | null;
  source_excerpt?: string | null;
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

interface AIWorkingDraft extends Omit<KnowledgeDraft, "keywords"> {
  keywords: string[];
}

interface KnowledgeChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
}

const EMPTY_KNOWLEDGE: KnowledgeDraft = {
  title: "",
  content: "",
  category: "company",
  department: "",
  location: "",
  keywords: "",
  source_id: null,
  source_excerpt: null,
  active: true,
};

const EMPTY_EVALUATION: EvaluationDraft = {
  question: "",
  expected_answer: "",
  department: "",
  location: "",
  active: true,
};

const INITIAL_CHAT_MESSAGE: KnowledgeChatMessage = {
  id: "knowledge-assistant-welcome",
  role: "assistant",
  content: "What should employees know?",
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

function AvailabilityToggle({
  checked,
  onChange,
  kind,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  kind: "answer" | "check";
}) {
  const activeLabel = kind === "answer" ? "Published" : "Active";
  const inactiveLabel = kind === "answer" ? "Draft" : "Paused";

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:col-span-2">
      <span>
        <span className="block text-sm font-semibold text-slate-800">
          {checked ? activeLabel : inactiveLabel}
        </span>
        <span className="block text-[11px] text-slate-500">
          {checked
            ? kind === "answer"
              ? "Employees can receive this answer"
              : "Included when active checks run"
            : kind === "answer"
              ? "Saved without being shown to employees"
              : "Saved without running in the active check set"}
        </span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={kind === "answer" ? "Publish answer" : "Include in active checks"}
          className="peer sr-only"
        />
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

function StatusBadge({
  active,
  kind,
}: {
  active: boolean;
  kind: "answer" | "check";
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active
        ? kind === "answer" ? "Published" : "Active"
        : kind === "answer" ? "Draft" : "Paused"}
    </span>
  );
}

function CheckResultBadge({ item }: { item: AssistantEvaluationCase }) {
  if (!item.active) return null;
  if (!item.latest_run) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        Not run
      </span>
    );
  }
  if (item.latest_run.status === "error") {
    return (
      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
        Error
      </span>
    );
  }
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${item.latest_run.passed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
      {item.latest_run.passed ? "Passed" : "Failed"}
    </span>
  );
}

function ScopeSelect({
  value,
  values,
  allLabel,
  onChange,
}: {
  value: string;
  values: string[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  const options = value && !values.includes(value) ? [value, ...values] : values;
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS}>
      <option value="">{allLabel}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
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
  departments,
  locations,
}: {
  initialKnowledge: AssistantKnowledgeEntry[];
  departments: string[];
  locations: string[];
}) {
  const [tab, setTab] = useState<Tab>("knowledge");
  const [prompt, setPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [evaluations, setEvaluations] = useState<AssistantEvaluationCase[]>([]);
  const [gaps, setGaps] = useState<AssistantKnowledgeGap[]>([]);
  const [gapStatusSupported, setGapStatusSupported] = useState(false);
  const [deferredLoading, setDeferredLoading] = useState(true);
  const [deferredLoaded, setDeferredLoaded] = useState(false);
  const [gapsRefreshing, setGapsRefreshing] = useState(false);
  const [gapBusyIds, setGapBusyIds] = useState<string[]>([]);
  const [pendingGapResolution, setPendingGapResolution] = useState<{
    ids: string[];
    message: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSource, setChatSource] = useState<string | null>(null);
  const [chatSourceId, setChatSourceId] = useState<string | null>(null);
  const [chatDrafts, setChatDrafts] = useState<AIWorkingDraft[]>([]);
  const [chatReviewNote, setChatReviewNote] = useState<string | null>(null);
  const [reviewingDraftIndex, setReviewingDraftIndex] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<KnowledgeChatMessage[]>([
    INITIAL_CHAT_MESSAGE,
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [aiDraftNote, setAiDraftNote] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [evaluationDraft, setEvaluationDraft] = useState<EvaluationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptVersions, setPromptVersions] = useState<AssistantPromptVersion[] | null>(null);
  const [promptVersionsMissing, setPromptVersionsMissing] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: CollectionTab;
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

  const publishedAnswers = knowledge.filter((entry) => entry.active).length;
  const activeChecks = evaluations.filter((item) => item.active);
  const passingChecks = activeChecks.filter((item) => item.latest_run?.passed).length;
  const errorChecks = activeChecks.filter((item) => item.latest_run?.status === "error").length;
  const failingChecks = activeChecks.filter(
    (item) => item.latest_run?.passed === false && item.latest_run.status !== "error",
  ).length;
  const notRunChecks = activeChecks.filter((item) => !item.latest_run).length;
  const orderedEvaluations = useMemo(
    () => [...evaluations].sort((left, right) => {
      const score = (item: AssistantEvaluationCase) =>
        !item.active ? 3 : item.latest_run?.passed === false ? 0 : !item.latest_run ? 1 : 2;
      return score(left) - score(right);
    }),
    [evaluations],
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [chatMessages, drafting]);

  const loadDeferredData = useCallback(async () => {
    setDeferredLoading(true);
    try {
      const response = await fetch("/api/settings/assistant-bootstrap", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load assistant settings");
      setPrompt(payload.initialPrompt);
      setSavedPrompt(payload.initialPrompt);
      setEvaluations(payload.evaluations ?? []);
      setGaps(payload.gaps ?? []);
      setGapStatusSupported(Boolean(payload.gapStatusSupported));
      setDeferredLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load assistant settings");
    } finally {
      setDeferredLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeferredData();
  }, [loadDeferredData]);

  const promptVersionsLoaded = promptVersions !== null;
  useEffect(() => {
    if (tab !== "prompt" || promptVersionsLoaded) return;
    void loadPromptVersions();
  }, [tab, promptVersionsLoaded]);

  async function loadPromptVersions() {
    try {
      const response = await fetch("/api/settings/assistant-prompt/versions", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load prompt history");
      setPromptVersions(payload.versions ?? []);
      setPromptVersionsMissing(Boolean(payload.tableMissing));
    } catch {
      // History is a convenience; the prompt editor works without it.
      setPromptVersions([]);
      setPromptVersionsMissing(true);
    }
  }

  async function savePrompt(event: React.FormEvent) {
    event.preventDefault();
    setPromptSaving(true);
    setPromptSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialPrompt: prompt }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save initial prompt");
      setPrompt(payload.initialPrompt);
      setSavedPrompt(payload.initialPrompt);
      setPromptSaved(true);
      void loadPromptVersions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save initial prompt");
    } finally {
      setPromptSaving(false);
    }
  }

  async function reload() {
    const [knowledgeResponse, evaluationResponse] = await Promise.all([
      fetch("/api/settings/assistant-knowledge", { cache: "no-store" }),
      fetch("/api/settings/assistant-evaluations", { cache: "no-store" }),
    ]);
    const knowledgePayload = await knowledgeResponse.json();
    const evaluationPayload = await evaluationResponse.json();
    if (!knowledgeResponse.ok) throw new Error(knowledgePayload.error ?? "Could not reload answers");
    if (!evaluationResponse.ok) throw new Error(evaluationPayload.error ?? "Could not reload quality checks");
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
      if (!response.ok) throw new Error(payload.error ?? "Could not save answer");
      await reload();
      if (pendingGapResolution) {
        void resolveGapAfterPublish(pendingGapResolution, payload.entry?.id ?? null);
        setPendingGapResolution(null);
      }
      setKnowledgeDraft(null);
      if (reviewingDraftIndex !== null) {
        setChatDrafts((current) => current.filter((_, index) => index !== reviewingDraftIndex));
        setChatMessages((current) => [
          ...current,
          {
            id: `knowledge-assistant-published-${Date.now()}`,
            role: "assistant",
            content: `Published "${knowledgeDraft.title}".`,
          },
        ]);
      }
      setReviewingDraftIndex(null);
      setAiDraftNote(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save answer");
    } finally {
      setBusy(false);
    }
  }

  async function generateKnowledgeDraft(event: React.FormEvent) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    const source = chatSource ?? message;
    const userMessage: KnowledgeChatMessage = {
      id: `knowledge-user-${Date.now()}`,
      role: "user",
      content: message,
    };
    setDrafting(true);
    setDraftError(null);
    setChatInput("");
    setChatMessages((current) => [...current, userMessage]);
    try {
      const response = await fetch("/api/settings/assistant-knowledge/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          sourceId: chatSourceId ?? undefined,
          refinement: chatSource ? message : "",
          currentDrafts: chatDrafts,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create knowledge draft");
      if (!Array.isArray(payload.drafts) || payload.drafts.length === 0) {
        throw new Error("The AI did not return any knowledge drafts");
      }

      setChatSource(source);
      setChatSourceId(payload.sourceId ?? null);
      setChatDrafts(payload.drafts);
      setChatReviewNote(payload.reviewNote ?? "Review this draft before publishing");
      setChatMessages((current) => [
        ...current,
        {
          id: `knowledge-assistant-${Date.now()}`,
          role: "assistant",
          content: `${chatSource ? "Updated" : "Created"} ${payload.drafts.length} knowledge ${payload.drafts.length === 1 ? "bit" : "bits"}. ${payload.reviewNote ?? "Ready for review."}`,
        },
      ]);
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : "Could not create knowledge draft");
      setChatInput(message);
      setChatMessages((current) => current.filter((item) => item.id !== userMessage.id));
    } finally {
      setDrafting(false);
    }
  }

  function reviewAIKnowledgeDraft(index: number) {
    const chatDraft = chatDrafts[index];
    if (!chatDraft) return;
    setReviewingDraftIndex(index);
    setAiDraftNote(chatReviewNote ?? "Review this draft before publishing");
    setKnowledgeDraft({
      ...chatDraft,
      keywords: chatDraft.keywords.join(", "),
    });
  }

  function resetKnowledgeChat() {
    setChatInput("");
    setChatSource(null);
    setChatSourceId(null);
    setChatDrafts([]);
    setChatReviewNote(null);
    setReviewingDraftIndex(null);
    setChatMessages([INITIAL_CHAT_MESSAGE]);
    setAiDraftNote(null);
    setDraftError(null);
    setPendingGapResolution(null);
  }

  async function refreshGaps() {
    setGapsRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-gaps", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not refresh gaps");
      setGaps(payload.gaps ?? []);
      setGapStatusSupported(Boolean(payload.statusSupported));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh gaps");
    } finally {
      setGapsRefreshing(false);
    }
  }

  async function dismissGap(gap: AssistantKnowledgeGap) {
    setGapBusyIds((current) => [...current, gap.id]);
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-gaps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: gap.ids, status: "dismissed", message: gap.message }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not dismiss gap");
      setGaps((current) => current.filter((item) => item.id !== gap.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not dismiss gap");
    } finally {
      setGapBusyIds((current) => current.filter((id) => id !== gap.id));
    }
  }

  function draftAnswerFromGap(gap: AssistantKnowledgeGap) {
    resetKnowledgeChat();
    setPendingGapResolution({ ids: gap.ids, message: gap.message });
    setChatInput(`Employees asked: "${gap.message}"\n\nDraft an approved knowledge answer for this. Facts to use:\n`);
    setChatMessages([
      INITIAL_CHAT_MESSAGE,
      {
        id: `knowledge-assistant-gap-${gap.id}`,
        role: "assistant",
        content: "Add the facts that answer this question below, then send. When the answer is published, the gap is marked resolved.",
      },
    ]);
    chatInputRef.current?.focus();
  }

  // Best effort: the answer is already published, so a failed gap update just
  // leaves the gap in the list to dismiss by hand.
  async function resolveGapAfterPublish(
    resolution: { ids: string[]; message: string },
    knowledgeId: string | null,
  ) {
    if (!gapStatusSupported) return;
    try {
      const response = await fetch("/api/settings/assistant-gaps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: resolution.ids,
          status: "resolved",
          message: resolution.message,
          ...(knowledgeId ? { knowledgeId } : {}),
        }),
      });
      if (response.ok) {
        setGaps((current) => current.filter((item) => !resolution.ids.includes(item.id)));
      }
    } catch {
      // Ignore: dismiss by hand covers this.
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
      if (!response.ok) throw new Error(payload.error ?? "Could not save quality check");
      await reload();
      setEvaluationDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save quality check");
    } finally {
      setBusy(false);
    }
  }

  async function reindexKnowledge() {
    setIndexing(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/assistant-knowledge/reindex", {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not reindex answers");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reindex answers");
    } finally {
      setIndexing(false);
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
      if (!response.ok) throw new Error(payload.error ?? "Could not run quality checks");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run quality checks");
    } finally {
      setRunning(null);
    }
  }

  function editKnowledge(entry: AssistantKnowledgeEntry) {
    setAiDraftNote(null);
    setReviewingDraftIndex(null);
    setKnowledgeDraft({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      department: entry.department ?? "",
      location: entry.location ?? "",
      keywords: entry.keywords.join(", "),
      source_id: entry.source_id,
      source_excerpt: entry.source_excerpt,
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
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">WhatsApp</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Employee assistant</h1>
        </div>
        <dl className="flex divide-x divide-slate-200 self-start sm:self-auto">
          <div className="pr-5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Answers published</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-800">
              {publishedAnswers} <span className="font-normal text-slate-400">of {knowledge.length}</span>
            </dd>
          </div>
          <div className="pl-5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Checks active</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-800">
              {deferredLoaded ? (
                <>{activeChecks.length} <span className="font-normal text-slate-400">of {evaluations.length}</span></>
              ) : (
                <span className="font-normal text-slate-400">Loading</span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" title="Dismiss" className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-rose-400 hover:bg-rose-100 hover:text-rose-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5" aria-hidden="true"><path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 border-b border-slate-200 sm:flex-row sm:items-end sm:justify-between">
            <div role="tablist" aria-label="Assistant settings" className="-mb-px flex min-w-0 overflow-x-auto">
              {(["knowledge", "gaps", "prompt", "tests"] as const).map((value) => (
                <button
                  key={value}
                  id={`assistant-${value}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={`assistant-${value}-panel`}
                  onClick={() => setTab(value)}
                  className={`h-11 shrink-0 border-b-2 px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${tab === value ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"}`}
                >
                  {value === "knowledge"
                    ? `Answers (${knowledge.length})`
                    : value === "gaps"
                      ? deferredLoaded ? `Gaps (${gaps.length})` : "Gaps"
                    : value === "prompt"
                      ? "Prompt"
                      : deferredLoaded ? `Checks (${evaluations.length})` : "Checks"}
                </button>
              ))}
            </div>

            {tab === "knowledge" ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 pb-3">
                <div className="relative min-w-0 flex-1 basis-full sm:max-w-xs sm:basis-auto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" />
                  </svg>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search answers" aria-label="Search answers" className={`${INPUT_CLASS} h-9 pl-9`} />
                </div>
                <button type="button" onClick={() => void reindexKnowledge()} disabled={indexing || knowledge.length === 0} className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                  {indexing ? "Indexing..." : "Reindex"}
                </button>
                <button type="button" onClick={() => { setAiDraftNote(null); setReviewingDraftIndex(null); setKnowledgeDraft({ ...EMPTY_KNOWLEDGE }); }} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
                  <PlusIcon /> New answer
                </button>
              </div>
            ) : tab === "tests" && deferredLoaded ? (
              <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
                <button type="button" onClick={() => void runTests()} disabled={running !== null || evaluations.every((item) => !item.active)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                  <PlayIcon /> {running === "all" ? "Running..." : "Run active checks"}
                </button>
                <button type="button" onClick={() => setEvaluationDraft({ ...EMPTY_EVALUATION })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
                  <PlusIcon /> New check
                </button>
              </div>
            ) : tab === "gaps" && deferredLoaded ? (
              <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
                <button type="button" onClick={() => void refreshGaps()} disabled={gapsRefreshing} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                  {gapsRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            ) : null}
          </div>

          <div id={`assistant-${tab}-panel`} role="tabpanel" aria-labelledby={`assistant-${tab}-tab`}>
            {tab !== "knowledge" && !deferredLoaded ? (
              <div className="border-y border-slate-200 py-12 text-center" aria-live="polite">
                {deferredLoading ? (
                  <p className="text-sm font-medium text-slate-500">Loading assistant settings...</p>
                ) : (
                  <button type="button" onClick={() => void loadDeferredData()} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Retry loading
                  </button>
                )}
              </div>
            ) : tab === "prompt" ? (
              <div className="space-y-6">
              <form onSubmit={savePrompt} className="space-y-3">
                <label htmlFor="assistant-initial-prompt" className="block text-sm font-semibold text-slate-800">
                  Initial prompt
                </label>
                <textarea
                  id="assistant-initial-prompt"
                  required
                  maxLength={ASSISTANT_INITIAL_PROMPT_MAX_LENGTH}
                  rows={20}
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setPromptSaved(false);
                  }}
                  className={`${INPUT_CLASS} min-h-96 resize-y font-mono text-xs leading-5`}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">
                    {prompt.length.toLocaleString()} / {ASSISTANT_INITIAL_PROMPT_MAX_LENGTH.toLocaleString()}
                  </span>
                  <div className="flex min-h-9 items-center gap-3">
                    {promptSaved && <span className="text-xs font-medium text-emerald-700">Saved</span>}
                    <button type="submit" disabled={promptSaving || prompt === savedPrompt || !prompt.trim()} className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                      {promptSaving ? "Saving..." : "Save prompt"}
                    </button>
                  </div>
                </div>
              </form>

              <section aria-labelledby="prompt-history-heading" className="space-y-2">
                <h2 id="prompt-history-heading" className="text-sm font-semibold text-slate-800">History</h2>
                {promptVersionsMissing ? (
                  <p className="text-xs text-slate-400">
                    Version history is unavailable until the assistant_prompt_versions migration is applied.
                  </p>
                ) : promptVersions === null ? (
                  <p className="text-xs text-slate-400">Loading history...</p>
                ) : promptVersions.length === 0 ? (
                  <p className="text-xs text-slate-400">No saved versions yet. Every save from now on is kept here.</p>
                ) : (
                  <ul className="divide-y divide-slate-200 border-y border-slate-200">
                    {promptVersions.map((version) => (
                      <li key={version.id} className="py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 text-xs text-slate-600">
                            <span className="font-medium text-slate-800">{formatTime(version.created_at)}</span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>{version.created_by}</span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>{version.prompt.length.toLocaleString()} characters</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setExpandedVersionId(expandedVersionId === version.id ? null : version.id)}
                              className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              {expandedVersionId === version.id ? "Hide" : "View"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPrompt(version.prompt);
                                setPromptSaved(false);
                              }}
                              disabled={version.prompt === prompt}
                              className="h-7 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Copy this version into the editor. Nothing changes until you save."
                            >
                              Restore
                            </button>
                          </div>
                        </div>
                        {expandedVersionId === version.id && (
                          <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-4 text-slate-700">{version.prompt}</pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              </div>
            ) : tab === "knowledge" ? (
              visibleKnowledge.length === 0 ? (
                <div className="border-y border-slate-200 py-12 text-center">
                  <p className="text-sm font-medium text-slate-600">
                    {knowledge.length === 0 ? "No answers yet" : "No answers match this search"}
                  </p>
                  {knowledge.length === 0 && (
                    <button type="button" onClick={() => { setAiDraftNote(null); setReviewingDraftIndex(null); setKnowledgeDraft({ ...EMPTY_KNOWLEDGE }); }} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
                      <PlusIcon /> New answer
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {visibleKnowledge.map((entry) => (
                    <article key={entry.id} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="min-w-0 break-words text-sm font-semibold text-slate-900">{entry.title}</h2>
                            <StatusBadge active={entry.active} kind="answer" />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-500">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">{CATEGORY_LABELS[entry.category]}</span>
                            <span>Audience: {scopeLabel(entry.department, entry.location)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button type="button" onClick={() => editKnowledge(entry)} aria-label={`Edit ${entry.title}`} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><PencilIcon /></button>
                          <button type="button" onClick={() => setDeleteTarget({ type: "knowledge", id: entry.id, label: entry.title })} aria-label={`Delete ${entry.title}`} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><TrashIcon /></button>
                        </div>
                      </div>
                      <div className="mt-3 border-l-2 border-blue-200 pl-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Approved reply</p>
                        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-600">{entry.content}</p>
                      </div>
                      <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
                        <p className="min-w-0 truncate text-[10px] text-slate-400">
                          {entry.keywords.length > 0 ? `Matches: ${entry.keywords.join(", ")}` : "No extra matching words"}
                        </p>
                        <p className="shrink-0 text-[10px] text-slate-400">Updated {formatTime(entry.updated_at)}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )
            ) : tab === "gaps" ? (
              gaps.length === 0 ? (
                <div className="border-y border-slate-200 py-12 text-center">
                  <p className="text-sm font-medium text-slate-600">No unanswered questions recorded</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border-y border-slate-200">
                  {gaps.map((gap) => (
                    <div key={gap.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-semibold text-slate-900">
                          {gap.message}
                          {gap.count > 1 && (
                            <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">
                              Asked {gap.count} times
                            </span>
                          )}
                        </p>
                        <span className="shrink-0 text-[10px] text-slate-400">{formatTime(gap.created_at)}</span>
                      </div>
                      {gap.rewritten_query !== gap.message && (
                        <p className="mt-1 text-xs text-slate-500">Searched for: {gap.rewritten_query}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] font-medium text-slate-400">
                          Audience: {scopeLabel(gap.department, gap.location)}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => draftAnswerFromGap(gap)}
                            className="h-7 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Draft answer
                          </button>
                          {gapStatusSupported && (
                            <button
                              type="button"
                              onClick={() => void dismissGap(gap)}
                              disabled={gapBusyIds.includes(gap.id)}
                              className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                            >
                              {gapBusyIds.includes(gap.id) ? "Dismissing..." : "Dismiss"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-4">
                <dl className="grid grid-cols-4 border-y border-slate-200">
                  <div className="border-r border-slate-200 px-3 py-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Passing</dt>
                    <dd className="mt-1 text-xl font-semibold text-emerald-700">{passingChecks}</dd>
                  </div>
                  <div className="border-r border-slate-200 px-3 py-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Failing</dt>
                    <dd className={`mt-1 text-xl font-semibold ${failingChecks ? "text-rose-700" : "text-slate-700"}`}>{failingChecks}</dd>
                  </div>
                  <div className="border-r border-slate-200 px-3 py-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Errors</dt>
                    <dd className={`mt-1 text-xl font-semibold ${errorChecks ? "text-slate-700" : "text-slate-400"}`}>{errorChecks}</dd>
                  </div>
                  <div className="px-3 py-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Not run</dt>
                    <dd className={`mt-1 text-xl font-semibold ${notRunChecks ? "text-amber-700" : "text-slate-700"}`}>{notRunChecks}</dd>
                  </div>
                </dl>

                {evaluations.length === 0 ? (
                  <div className="border-y border-slate-200 py-12 text-center">
                    <p className="text-sm font-medium text-slate-600">No quality checks yet</p>
                    <button type="button" onClick={() => setEvaluationDraft({ ...EMPTY_EVALUATION })} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
                      <PlusIcon /> New check
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orderedEvaluations.map((item) => (
                      <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="break-words text-sm font-semibold text-slate-900">{item.question}</h2>
                              <StatusBadge active={item.active} kind="check" />
                              <CheckResultBadge item={item} />
                            </div>
                            <p className="mt-1.5 text-[10px] font-medium text-slate-500">Audience: {scopeLabel(item.department, item.location)}</p>
                            <div className="mt-3 border-l-2 border-slate-200 pl-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Expected reply</p>
                              <p className="mt-1 text-xs leading-5 text-slate-600">{item.expected_answer}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                            <button type="button" onClick={() => void runTests(item.id)} disabled={running !== null} aria-label={`Run quality check ${item.question}`} title="Run check" className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"><PlayIcon /></button>
                            <button type="button" onClick={() => editEvaluation(item)} aria-label={`Edit quality check ${item.question}`} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><PencilIcon /></button>
                            <button type="button" onClick={() => setDeleteTarget({ type: "tests", id: item.id, label: item.question })} aria-label={`Delete quality check ${item.question}`} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><TrashIcon /></button>
                          </div>
                        </div>
                        {item.latest_run && (
                          item.latest_run.status === "error" ? (
                            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase text-slate-600">Check error</span>
                                <span className="text-[10px] text-slate-400">{formatTime(item.latest_run.created_at)}</span>
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-600">{item.latest_run.reason}</p>
                              <p className="mt-1 text-[10px] text-slate-400">The check itself could not run. This is not an answer failure. Run it again.</p>
                            </div>
                          ) : (
                          <div className={`mt-4 rounded-lg border p-3 ${item.latest_run.passed ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/60"}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-[10px] font-semibold uppercase ${item.latest_run.passed ? "text-emerald-700" : "text-rose-700"}`}>{item.latest_run.passed ? "Passed" : "Failed"}</span>
                              <span className="text-[10px] text-slate-400">{formatTime(item.latest_run.created_at)}</span>
                            </div>
                            <div className="mt-2 grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Assistant reply</p>
                                <p className="mt-1 text-xs leading-5 text-slate-600">{item.latest_run.answer || "No answer returned"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Evaluator finding</p>
                                <p className="mt-1 text-xs leading-5 text-slate-600">{item.latest_run.reason}</p>
                              </div>
                            </div>
                          </div>
                          )
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="order-first min-w-0 lg:order-last lg:sticky lg:top-6">
          <section aria-labelledby="knowledge-assistant-heading" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-blue-600">Knowledge assistant</p>
                <h2 id="knowledge-assistant-heading" className="mt-0.5 truncate text-sm font-semibold text-slate-900">Build an approved answer</h2>
              </div>
              {(chatSource || chatMessages.length > 1) && (
                <button type="button" onClick={resetKnowledgeChat} disabled={drafting} className="shrink-0 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40">
                  New chat
                </button>
              )}
            </div>

            <div aria-live="polite" className="h-64 space-y-2 overflow-y-auto px-3 py-3 lg:h-[26rem]">
              {chatMessages.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <p className={`max-w-[90%] break-words whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-5 ${message.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                    {message.content}
                  </p>
                </div>
              ))}
              {drafting && (
                <div className="flex justify-start">
                  <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Creating draft...</p>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {draftError && <div role="alert" className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{draftError}</div>}

            {chatDrafts.length > 0 && (
              <div className="max-h-72 overflow-y-auto border-t border-slate-100 bg-emerald-50/60">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-800">
                    {chatDrafts.length} knowledge {chatDrafts.length === 1 ? "bit" : "bits"}
                  </p>
                  <p className="text-[10px] text-slate-500">Review and publish separately</p>
                </div>
                {chatDrafts.map((draft, index) => (
                  <div key={`${draft.title}-${index}`} className="border-t border-emerald-100 px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-xs font-semibold text-slate-900">{draft.title}</p>
                        <p className="mt-1 text-[10px] leading-4 text-slate-500">
                          {CATEGORY_LABELS[draft.category]} / {scopeLabel(draft.department || null, draft.location || null)} / {draft.keywords.length} keywords
                        </p>
                      </div>
                      <button type="button" onClick={() => reviewAIKnowledgeDraft(index)} className="h-8 shrink-0 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800">
                        Review
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={generateKnowledgeDraft} className="border-t border-slate-100 p-3">
              <label>
                <span className="sr-only">Message knowledge assistant</span>
                <textarea
                  ref={chatInputRef}
                  required
                  maxLength={chatSource ? 4000 : ASSISTANT_KNOWLEDGE_SOURCE_MAX_LENGTH}
                  rows={4}
                  value={chatInput}
                  onChange={(event) => {
                    setChatInput(event.target.value);
                    setDraftError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={chatSource ? "Ask for changes to the knowledge bits" : "Paste notes, a transcript, or other source material"}
                  className={`${INPUT_CLASS} min-h-24 resize-y leading-5`}
                />
              </label>
              <div className="mt-2 flex justify-end">
                <button type="submit" disabled={drafting || !chatInput.trim()} className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                  Send
                </button>
              </div>
            </form>
          </section>
        </aside>
      </div>

      <Modal title={knowledgeDraft?.id ? "Edit approved answer" : "New approved answer"} open={knowledgeDraft !== null} busy={busy} onClose={() => { setKnowledgeDraft(null); setAiDraftNote(null); setReviewingDraftIndex(null); }} onSubmit={saveKnowledge}>
        {knowledgeDraft && (
          <div className="space-y-5">
            {aiDraftNote && (
              <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <span className="font-semibold">AI draft:</span> {aiDraftNote}
              </div>
            )}
            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:col-span-2">Answer</h3>
              <Field label="Employee question or topic" className="sm:col-span-2"><input required maxLength={160} value={knowledgeDraft.title} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, title: event.target.value })} placeholder="How do I submit an expense receipt?" className={INPUT_CLASS} /></Field>
              <Field label="Approved reply" className="sm:col-span-2"><textarea required maxLength={8000} rows={7} value={knowledgeDraft.content} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, content: event.target.value })} className={`${INPUT_CLASS} resize-y leading-5`} /></Field>
            </section>

            <section className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:col-span-2">Matching</h3>
              <Field label="Category"><select value={knowledgeDraft.category} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, category: event.target.value as AssistantCategory })} className={INPUT_CLASS}>{ASSISTANT_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></Field>
              <Field label="Also match these words"><input value={knowledgeDraft.keywords} onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, keywords: event.target.value })} placeholder="vacation, holiday, absence" className={INPUT_CLASS} /></Field>
            </section>

            <section className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:col-span-2">Audience</h3>
              <Field label="Department"><ScopeSelect value={knowledgeDraft.department} values={departments} allLabel="All departments" onChange={(department) => setKnowledgeDraft({ ...knowledgeDraft, department })} /></Field>
              <Field label="Office"><ScopeSelect value={knowledgeDraft.location} values={locations} allLabel="All offices" onChange={(location) => setKnowledgeDraft({ ...knowledgeDraft, location })} /></Field>
            </section>

            <AvailabilityToggle checked={knowledgeDraft.active} onChange={(active) => setKnowledgeDraft({ ...knowledgeDraft, active })} kind="answer" />
          </div>
        )}
      </Modal>

      <Modal title={evaluationDraft?.id ? "Edit quality check" : "New quality check"} open={evaluationDraft !== null} busy={busy} onClose={() => setEvaluationDraft(null)} onSubmit={saveEvaluation}>
        {evaluationDraft && (
          <div className="space-y-5">
            <section className="grid gap-4 sm:grid-cols-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:col-span-2">Conversation</h3>
              <Field label="Employee question" className="sm:col-span-2"><textarea required maxLength={2000} rows={3} value={evaluationDraft.question} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, question: event.target.value })} className={`${INPUT_CLASS} resize-y`} /></Field>
              <Field label="Expected reply" className="sm:col-span-2"><textarea required maxLength={8000} rows={6} value={evaluationDraft.expected_answer} onChange={(event) => setEvaluationDraft({ ...evaluationDraft, expected_answer: event.target.value })} className={`${INPUT_CLASS} resize-y`} /></Field>
            </section>

            <section className="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:col-span-2">Test employee</h3>
              <Field label="Department"><ScopeSelect value={evaluationDraft.department} values={departments} allLabel="Any department" onChange={(department) => setEvaluationDraft({ ...evaluationDraft, department })} /></Field>
              <Field label="Office"><ScopeSelect value={evaluationDraft.location} values={locations} allLabel="Any office" onChange={(location) => setEvaluationDraft({ ...evaluationDraft, location })} /></Field>
            </section>

            <AvailabilityToggle checked={evaluationDraft.active} onChange={(active) => setEvaluationDraft({ ...evaluationDraft, active })} kind="check" />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.type === "knowledge" ? "Delete answer?" : "Delete quality check?"}
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
