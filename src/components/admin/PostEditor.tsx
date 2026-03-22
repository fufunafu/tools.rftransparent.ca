"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface FormData {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  category: string;
  tags: string;
  content: string;
  published: boolean;
  og_image: string;
}

const EMPTY: FormData = {
  slug: "", title: "", date: new Date().toISOString().slice(0, 10),
  excerpt: "", category: "", tags: "", content: "", published: false, og_image: "",
};

interface Props { slug: string | null }

export default function PostEditor({ slug }: Props) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(!!slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/content/posts/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        setForm({ ...data, tags: (data.tags ?? []).join(", "), og_image: data.og_image ?? "" });
        setLoading(false);
      });
  }, [slug]);

  function set(key: keyof FormData, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      ...form,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      og_image: form.og_image || null,
    };

    const url = slug
      ? `/api/content/posts/${slug}`
      : "/api/content/posts";
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

    router.push("/admin/content/posts");
  }

  if (loading) return <p className="text-sm text-sand-400 p-8">Loading...</p>;

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
      {/* Meta bar */}
      <div className="border-b border-sand-200/60 bg-white px-6 py-3 shrink-0 flex items-center gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Slug"
          value={form.slug}
          onChange={(e) => set("slug", e.target.value)}
          disabled={!!slug}
          className="text-xs font-mono border border-sand-200 rounded px-2 py-1 w-48 bg-white disabled:bg-sand-50 disabled:text-sand-400 focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <input
          type="date"
          value={form.date}
          onChange={(e) => set("date", e.target.value)}
          className="text-xs border border-sand-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <input
          type="text"
          placeholder="Category"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          className="text-xs border border-sand-200 rounded px-2 py-1 w-36 bg-white focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <input
          type="text"
          placeholder="Tags (comma-separated)"
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
          className="text-xs border border-sand-200 rounded px-2 py-1 flex-1 min-w-[160px] bg-white focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <label className="flex items-center gap-1.5 text-xs text-sand-600 cursor-pointer">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => set("published", e.target.checked)}
            className="accent-accent"
          />
          Published
        </label>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="text-xs px-3 py-1 border border-sand-200 rounded-lg text-sand-600 hover:bg-sand-50 transition-colors"
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {/* Title + excerpt */}
      <div className="bg-white border-b border-sand-200/60 px-8 py-4 shrink-0 space-y-3">
        <input
          type="text"
          placeholder="Post title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          className="w-full text-2xl font-semibold text-sand-900 border-0 focus:outline-none placeholder:text-sand-300 bg-transparent"
        />
        <input
          type="text"
          placeholder="Excerpt / description"
          value={form.excerpt}
          onChange={(e) => set("excerpt", e.target.value)}
          className="w-full text-sm text-sand-500 border-0 focus:outline-none placeholder:text-sand-300 bg-transparent"
        />
      </div>

      {/* Content / preview */}
      <div className="flex-1 overflow-auto bg-white">
        {preview ? (
          <div className="p-8 max-w-3xl mx-auto prose text-sand-700 whitespace-pre-wrap text-sm leading-relaxed">
            {form.content || <span className="text-sand-300 italic">Nothing to preview yet.</span>}
          </div>
        ) : (
          <textarea
            value={form.content}
            onChange={(e) => set("content", e.target.value)}
            placeholder="Write in Markdown..."
            className="w-full h-full p-8 text-sm font-mono text-sand-800 bg-white border-0 focus:outline-none resize-none leading-relaxed"
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-sand-200/60 bg-white px-6 py-3 shrink-0 flex items-center gap-3">
        {error && <p className="text-sm text-red-500 flex-1">{error}</p>}
        <div className="flex items-center gap-3 ml-auto">
          <a href="/admin/content/posts" className="text-sm text-sand-500 hover:text-sand-900 transition-colors">
            Cancel
          </a>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : slug ? "Save changes" : "Create post"}
          </button>
        </div>
      </div>
    </form>
  );
}
