"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SurveyInfo {
  employee_name: string;
  week_of: string;
  already_responded: boolean;
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="text-4xl transition-transform hover:scale-110 focus:outline-none"
          aria-label={`${star} star${star !== 1 ? "s" : ""}`}
        >
          <span className={(hovered || value) >= star ? "text-amber-400" : "text-gray-200"}>★</span>
        </button>
      ))}
    </div>
  );
}

const LABELS: Record<number, string> = {
  1: "Not great",
  2: "Could be better",
  3: "Okay",
  4: "Pretty good",
  5: "Excellent!",
};

export default function SurveyPage() {
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<SurveyInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [score, setScore] = useState(0);
  const [highlights, setHighlights] = useState("");
  const [complaints, setComplaints] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/survey/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setNotFound(true); return; }
        setInfo(d);
        if (d.already_responded) setSubmitted(true);
      })
      .catch(() => setNotFound(true));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (score === 0) { setError("Please select a satisfaction rating."); return; }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/survey/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ satisfaction_score: score, highlights, complaints, suggestions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const weekLabel = info?.week_of
    ? new Date(info.week_of + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-2xl mb-2">🔍</p>
          <p className="text-gray-600">This survey link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center space-y-3">
          <p className="text-4xl">🙌</p>
          <h1 className="text-xl font-semibold text-gray-900">Thank you, {info.employee_name}!</h1>
          <p className="text-gray-500 text-sm">Your response has been recorded. We appreciate your feedback.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-lg w-full space-y-6"
      >
        <div>
          <p className="text-2xl font-bold text-gray-900">Hi {info.employee_name} 👋</p>
          <p className="text-sm text-gray-400 mt-1">Weekly check-in · Week of {weekLabel}</p>
        </div>

        {/* Satisfaction score */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            How satisfied are you at work this week?
          </label>
          <StarRating value={score} onChange={setScore} />
          {score > 0 && (
            <p className="text-sm text-amber-600 font-medium">{LABELS[score]}</p>
          )}
        </div>

        {/* What went well */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            What went well this week? <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={highlights}
            onChange={(e) => setHighlights(e.target.value)}
            rows={3}
            placeholder="Share anything that went well..."
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
          />
        </div>

        {/* Issues */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Any issues or concerns? <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={complaints}
            onChange={(e) => setComplaints(e.target.value)}
            rows={3}
            placeholder="Anything bothering you or that could be improved..."
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
          />
        </div>

        {/* Suggestions */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Is there anything you&apos;d like us to address? <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={suggestions}
            onChange={(e) => setSuggestions(e.target.value)}
            rows={3}
            placeholder="Requests, ideas, or anything you'd like management to know..."
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-amber-400 hover:bg-amber-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>
  );
}
