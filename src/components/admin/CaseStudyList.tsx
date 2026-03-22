"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface CaseStudy {
  id: string;
  slug: string;
  title: string;
  category: string;
  year: string;
  display_order: number;
}

export default function CaseStudyList() {
  const [studies, setStudies] = useState<CaseStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/content/case-studies")
      .then((r) => r.json())
      .then(setStudies)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(slug: string) {
    if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return;
    setDeletingSlug(slug);
    await fetch(`/api/content/case-studies/${slug}`, { method: "DELETE" });
    setStudies((prev) => prev.filter((s) => s.slug !== slug));
    setDeletingSlug(null);
  }

  if (loading) return <p className="text-sm text-sand-400">Loading...</p>;

  if (studies.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sand-400 text-sm">No case studies yet.</p>
        <a href="/admin/content/case-studies/new" className="mt-4 inline-block text-sm text-accent hover:underline">
          Create your first one
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {studies.map((study) => (
        <div key={study.id} className="flex items-center justify-between bg-white rounded-xl border border-sand-200/60 px-5 py-4">
          <div>
            <p className="font-medium text-sand-900">{study.title}</p>
            <p className="text-xs text-sand-400 mt-0.5">{study.category} · {study.year || "No year"} · <code className="font-mono">{study.slug}</code></p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => router.push(`/admin/content/case-studies/${study.slug}`)}
              className="px-3 py-1.5 text-xs text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(study.slug)}
              disabled={deletingSlug === study.slug}
              className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deletingSlug === study.slug ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
