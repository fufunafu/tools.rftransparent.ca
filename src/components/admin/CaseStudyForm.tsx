"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface FormData {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  year: string;
  image: string;
  context: string;
  problem: string;
  approach: string;
  execution: string;
  outcomes: string;
  learned: string;
  display_order: number;
}

const EMPTY: FormData = {
  slug: "", title: "", subtitle: "", category: "", year: "", image: "",
  context: "", problem: "", approach: "", execution: "", outcomes: "", learned: "",
  display_order: 0,
};

interface Props { slug: string | null }

export default function CaseStudyForm({ slug }: Props) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(!!slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/content/case-studies/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        setForm({ ...data, outcomes: (data.outcomes ?? []).join("\n") });
        setLoading(false);
      });
  }, [slug]);

  function set(key: keyof FormData, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      ...form,
      outcomes: form.outcomes.split("\n").map((s) => s.trim()).filter(Boolean),
      display_order: Number(form.display_order),
    };

    const url = slug
      ? `/api/content/case-studies/${slug}`
      : "/api/content/case-studies";
    const method = slug ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      setSaving(false);
      return;
    }

    router.push("/admin/content/case-studies");
  }

  if (loading) return <p className="text-sm text-sand-400">Loading...</p>;

  const fields: { key: keyof FormData; label: string; multiline?: boolean; hint?: string }[] = [
    { key: "slug", label: "Slug", hint: "URL-safe identifier, e.g. scaling-warehouse-infrastructure" },
    { key: "title", label: "Title" },
    { key: "subtitle", label: "Subtitle" },
    { key: "category", label: "Category", hint: "e.g. Operations, AI & Engineering, Strategy" },
    { key: "year", label: "Year", hint: "e.g. 2023" },
    { key: "image", label: "Image path", hint: "e.g. /images/warehouse.jpg" },
    { key: "context", label: "Context", multiline: true },
    { key: "problem", label: "Problem", multiline: true },
    { key: "approach", label: "Approach", multiline: true },
    { key: "execution", label: "Execution", multiline: true },
    { key: "outcomes", label: "Outcomes", multiline: true, hint: "One outcome per line" },
    { key: "learned", label: "What I Learned", multiline: true },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {fields.map(({ key, label, multiline, hint }) => (
        <div key={key}>
          <label className="block text-xs font-medium text-sand-600 mb-1">
            {label}
            {hint && <span className="ml-2 text-sand-400 font-normal">{hint}</span>}
          </label>
          {multiline ? (
            <textarea
              value={form[key] as string}
              onChange={(e) => set(key, e.target.value)}
              rows={key === "outcomes" ? 4 : 5}
              className="w-full text-sm border border-sand-200 rounded-lg px-3 py-2 bg-white text-sand-900 focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y"
            />
          ) : (
            <input
              type="text"
              value={form[key] as string}
              onChange={(e) => set(key, e.target.value)}
              disabled={key === "slug" && !!slug}
              className="w-full text-sm border border-sand-200 rounded-lg px-3 py-2 bg-white text-sand-900 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:bg-sand-50 disabled:text-sand-400"
            />
          )}
        </div>
      ))}

      <div>
        <label className="block text-xs font-medium text-sand-600 mb-1">
          Display order <span className="text-sand-400 font-normal">lower = shown first</span>
        </label>
        <input
          type="number"
          value={form.display_order}
          onChange={(e) => set("display_order", e.target.value)}
          className="w-24 text-sm border border-sand-200 rounded-lg px-3 py-2 bg-white text-sand-900 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : slug ? "Save changes" : "Create case study"}
        </button>
        <a href="/admin/content/case-studies" className="text-sm text-sand-500 hover:text-sand-900 transition-colors">
          Cancel
        </a>
      </div>
    </form>
  );
}
