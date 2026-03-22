"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Post {
  id: string;
  slug: string;
  title: string;
  date: string;
  category: string;
  published: boolean;
}

export default function PostList() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/content/posts")
      .then((r) => r.json())
      .then(setPosts)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(slug: string) {
    if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return;
    setDeletingSlug(slug);
    await fetch(`/api/content/posts/${slug}`, { method: "DELETE" });
    setPosts((prev) => prev.filter((p) => p.slug !== slug));
    setDeletingSlug(null);
  }

  async function handleTogglePublished(post: Post) {
    setTogglingSlug(post.slug);
    const res = await fetch(`/api/content/posts/${post.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !post.published }),
    });
    if (res.ok) {
      setPosts((prev) => prev.map((p) => p.slug === post.slug ? { ...p, published: !p.published } : p));
    }
    setTogglingSlug(null);
  }

  if (loading) return <p className="text-sm text-sand-400">Loading...</p>;

  if (posts.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sand-400 text-sm">No posts yet.</p>
        <a href="/admin/content/posts/new" className="mt-4 inline-block text-sm text-accent hover:underline">
          Write your first post
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <div key={post.id} className="flex items-center justify-between bg-white rounded-xl border border-sand-200/60 px-5 py-4">
          <div>
            <p className="font-medium text-sand-900">{post.title}</p>
            <p className="text-xs text-sand-400 mt-0.5">
              {post.category} · {new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} ·{" "}
              <code className="font-mono">{post.slug}</code>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleTogglePublished(post)}
              disabled={togglingSlug === post.slug}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                post.published
                  ? "text-green-700 border-green-200 bg-green-50 hover:bg-green-100"
                  : "text-sand-500 border-sand-200 hover:bg-sand-50"
              }`}
            >
              {post.published ? "Published" : "Draft"}
            </button>
            <button
              onClick={() => router.push(`/admin/content/posts/${post.slug}`)}
              className="px-3 py-1.5 text-xs text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(post.slug)}
              disabled={deletingSlug === post.slug}
              className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deletingSlug === post.slug ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
