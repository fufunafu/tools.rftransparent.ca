"use client";

import { use, useEffect, useMemo, useState } from "react";
import type {
  SurveyPrivacyModel,
  SurveyQuestionSnapshot,
  SurveyType,
} from "@/lib/survey-program";

interface SurveyInfo {
  employee_name: string;
  title: string;
  purpose: string;
  survey_type: SurveyType;
  privacy_model: SurveyPrivacyModel;
  questions: SurveyQuestionSnapshot[];
  closes_at: string | null;
  already_responded: boolean;
  closed: boolean;
  privacy_notice: string[];
  error?: string;
}

type AnswerValue = number | string | boolean;

function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold tracking-tight shadow-sm ${inverted ? "bg-white/15 text-white ring-1 ring-white/20" : "bg-blue-600 text-white"}`}>
        RF
      </span>
      <span className={`text-sm font-semibold ${inverted ? "text-white" : "text-slate-900"}`}>
        RF Transparent
      </span>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-slate-100 px-4 py-6 sm:px-6 sm:py-10">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="absolute -bottom-48 -right-24 h-[28rem] w-[28rem] rounded-full bg-cyan-100/70 blur-3xl" />
      </div>
      <div className="relative mx-auto flex min-h-[calc(100dvh-3rem)] max-w-5xl items-center justify-center sm:min-h-[calc(100dvh-5rem)]">
        {children}
      </div>
    </main>
  );
}

function CenteredState({
  title,
  detail,
  tone = "blue",
}: {
  title: string;
  detail: string;
  tone?: "blue" | "green" | "slate";
}) {
  const iconStyle = {
    blue: "bg-blue-50 text-blue-600 ring-blue-100",
    green: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    slate: "bg-slate-100 text-slate-500 ring-slate-200",
  }[tone];
  return (
    <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/80 bg-white/95 shadow-2xl shadow-slate-300/30 backdrop-blur">
      <div className="border-b border-slate-100 px-6 py-4"><BrandMark /></div>
      <div className="px-6 py-12 text-center sm:px-10">
        <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-3xl ring-8 ${iconStyle}`} aria-hidden="true">
          {tone === "green" ? "✓" : tone === "slate" ? "×" : "…"}
        </span>
        <h1 className="mt-7 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function ScaleQuestion({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestionSnapshot;
  value: AnswerValue | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold leading-5 text-slate-800">
        {question.prompt}{question.required && <span className="ml-1 text-blue-600">*</span>}
      </legend>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
        {(question.options ?? []).map((option) => (
          <label key={String(option.value)} className="group cursor-pointer">
            <input
              type="radio"
              name={question.metric_key}
              value={String(option.value)}
              checked={value === option.value}
              onChange={() => onChange(Number(option.value))}
              className="peer sr-only"
              required={question.required}
            />
            <span className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-2 py-2 text-center text-xs font-semibold text-slate-600 shadow-sm transition group-hover:border-blue-200 peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-blue-200 sm:min-h-[72px]">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function BooleanQuestion({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestionSnapshot;
  value: AnswerValue | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold leading-5 text-slate-800">
        {question.prompt}{question.required && <span className="ml-1 text-blue-600">*</span>}
      </legend>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
        {(question.options ?? [{ value: true, label: "Yes" }, { value: false, label: "No" }]).map((option) => (
          <label key={String(option.value)} className="cursor-pointer">
            <input
              type="radio"
              name={question.metric_key}
              checked={value === option.value}
              onChange={() => onChange(option.value === true)}
              className="peer sr-only"
              required={question.required}
            />
            <span className="flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 shadow-sm transition peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-blue-200">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ChoiceQuestion({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestionSnapshot;
  value: AnswerValue | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={question.metric_key} className="text-sm font-semibold leading-5 text-slate-800">
        {question.prompt}{question.required && <span className="ml-1 text-blue-600">*</span>}
      </label>
      <select
        id={question.metric_key}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        required={question.required}
        className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
      >
        <option value="">Choose an answer</option>
        {(question.options ?? []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function TextQuestion({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestionSnapshot;
  value: AnswerValue | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={question.metric_key} className="text-sm font-semibold leading-5 text-slate-800">
        {question.prompt}
        {!question.required && <span className="ml-1.5 text-xs font-normal text-slate-400">Optional</span>}
      </label>
      <textarea
        id={question.metric_key}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        maxLength={4000}
        required={question.required}
        placeholder="Share anything you would like management to understand..."
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 text-base leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 sm:text-sm"
      />
    </div>
  );
}

function surveyLabel(type: SurveyType): string {
  return {
    weekly: "Weekly pulse",
    quarterly: "Quarterly engagement",
    onboarding: "New employee check-in",
    exit: "Voluntary exit survey",
    targeted: "Targeted team survey",
  }[type];
}

export default function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<SurveyInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/survey/${token}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as SurveyInfo }))
      .then(({ response, data }) => {
        if (!response.ok || data.error) {
          setNotFound(true);
          return;
        }
        setInfo(data);
        setSubmitted(data.already_responded);
      })
      .catch(() => setNotFound(true));
  }, [token]);

  const answeredRequired = useMemo(() => {
    if (!info) return false;
    return info.questions.every((question) => {
      if (!question.required) return true;
      const value = answers[question.metric_key];
      return value !== undefined && value !== null && value !== "";
    });
  }, [answers, info]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!info || !answeredRequired) {
      setError("Please answer every required question.");
      return;
    }
    if (!privacyAccepted) {
      setError("Please confirm that you understand how this survey is handled.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/survey/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: info.questions
            .filter((question) => answers[question.metric_key] !== undefined && answers[question.metric_key] !== "")
            .map((question) => ({ metric_key: question.metric_key, value: answers[question.metric_key] })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to submit");
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (notFound) {
    return <PageShell><CenteredState tone="slate" title="This link is not available" detail="This survey link is invalid. Ask your manager for a new link." /></PageShell>;
  }
  if (!info) {
    return <PageShell><CenteredState title="Opening your check-in" detail="This will only take a moment." /></PageShell>;
  }
  if (submitted) {
    return <PageShell><CenteredState tone="green" title={`Thank you, ${info.employee_name}`} detail="Your response has been recorded. You can safely close this window." /></PageShell>;
  }
  if (info.closed) {
    return <PageShell><CenteredState tone="slate" title="This survey is closed" detail="The response window has ended. Thank you for checking in." /></PageShell>;
  }

  return (
    <PageShell>
      <div className="grid w-full overflow-hidden rounded-3xl border border-white/80 bg-white shadow-2xl shadow-slate-300/35 lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-800 to-slate-950 px-6 py-7 text-white sm:px-8 lg:flex lg:flex-col lg:justify-between lg:px-10 lg:py-10">
          <div className="relative">
            <BrandMark inverted />
            <div className="mt-8 lg:mt-20">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-200">{surveyLabel(info.survey_type)}</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Hi, {info.employee_name}</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-blue-100/90">{info.purpose}</p>
            </div>
          </div>
          <div className="relative mt-8 space-y-3 lg:mt-16">
            {info.closes_at && (
              <p className="text-xs text-blue-100">Open until {new Date(info.closes_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>
            )}
            <span className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-blue-50 ring-1 ring-white/15">A few minutes</span>
          </div>
        </aside>

        <form onSubmit={submit} className="bg-white px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
          <header className="border-b border-slate-100 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Your response</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{info.title}</h2>
            <p className="mt-1 text-xs text-slate-400">Questions marked * are required.</p>
          </header>

          <div className="space-y-7 py-6">
            {info.questions.map((question) => {
              const setValue = (value: AnswerValue) => {
                setAnswers((current) => ({ ...current, [question.metric_key]: value }));
                setError("");
              };
              if (question.response_type === "scale") {
                return <ScaleQuestion key={question.metric_key} question={question} value={answers[question.metric_key]} onChange={setValue} />;
              }
              if (question.response_type === "boolean") {
                return <BooleanQuestion key={question.metric_key} question={question} value={answers[question.metric_key]} onChange={setValue} />;
              }
              if (question.response_type === "single_choice") {
                return <ChoiceQuestion key={question.metric_key} question={question} value={answers[question.metric_key]} onChange={setValue} />;
              }
              return <TextQuestion key={question.metric_key} question={question} value={answers[question.metric_key]} onChange={setValue} />;
            })}
          </div>

          <section className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-800">Privacy and use</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-blue-900/80">
              {info.privacy_notice.map((notice) => <li key={notice}>• {notice}</li>)}
            </ul>
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs font-medium leading-5 text-blue-950">
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(event) => setPrivacyAccepted(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              />
              I understand how my response will be collected, used, accessed, and retained.
            </label>
          </section>

          {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={submitting || !answeredRequired || !privacyAccepted}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {submitting ? "Sending your response…" : "Send my response"}
          </button>
          <p className="mt-3 text-center text-[11px] leading-4 text-slate-400">This link is unique to your survey. Please do not share it.</p>
        </form>
      </div>
    </PageShell>
  );
}
