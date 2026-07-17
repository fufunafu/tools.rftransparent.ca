"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Analysis {
  id: string;
  title: string;
  analysis_date: string;
  content: string;
  created_by: string | null;
  created_at: string;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Minimal markdown rendering for analysis write-ups: headings, bullets, bold,
// paragraphs. Deliberately no dependency — content is trusted (written by us).
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-sand-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

function MarkdownLite({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = content.split("\n");
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key++} className="list-disc pl-5 space-y-1.5 text-sm text-sand-700 leading-relaxed">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item, `li${key}-${i}`)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    flushList();
    if (line.startsWith("### ")) {
      blocks.push(
        <h4 key={key++} className="text-sm font-semibold text-sand-900 mt-4">
          {renderInline(line.slice(4), `h4-${key}`)}
        </h4>
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h3 key={key++} className="text-base font-semibold text-sand-900 mt-5">
          {renderInline(line.slice(3), `h3-${key}`)}
        </h3>
      );
    } else if (line.startsWith("# ")) {
      blocks.push(
        <h2 key={key++} className="text-lg font-semibold text-sand-900 mt-5">
          {renderInline(line.slice(2), `h2-${key}`)}
        </h2>
      );
    } else if (line.trim() !== "") {
      blocks.push(
        <p key={key++} className="text-sm text-sand-700 leading-relaxed">
          {renderInline(line, `p-${key}`)}
        </p>
      );
    }
  }
  flushList();

  return <div className="space-y-3">{blocks}</div>;
}

// Rich analyses are stored as complete self-contained HTML documents and
// rendered in a sandboxed iframe (scripts allowed, no same-origin access).
// The document posts {rfAnalysisHeight} so the frame grows to fit.
function HtmlReport({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1400);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const h = (e.data as { rfAnalysisHeight?: number })?.rfAnalysisHeight;
      if (typeof h === "number" && h > 200 && h < 40000) setHeight(h + 8);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      sandbox="allow-scripts"
      srcDoc={html}
      title="Analysis report"
      className="w-full rounded-lg border border-sand-200/60 bg-white"
      style={{ height }}
    />
  );
}

function isHtmlContent(content: string) {
  const head = content.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

export default function AnalysisTab() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // New-analysis form (rarely used, so collapsed by default)
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/marketing/analyses");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load analyses");
      const list: Analysis[] = json.analyses ?? [];
      setAnalyses(list);
      if (list.length > 0) setOpenId((cur) => cur ?? list[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/marketing/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setTitle("");
      setContent("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    try {
      const res = await fetch(`/api/marketing/analyses?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete");
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (loading) return <div className="text-center py-12 text-sand-400">Loading analyses...</div>;

  return (
    <div className="space-y-4 max-w-5xl">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-sand-500">
          {analyses.length === 0
            ? "No saved analyses yet."
            : `${analyses.length} saved ${analyses.length === 1 ? "analysis" : "analyses"}.`}{" "}
          Written occasionally — deep-dive reviews of ad performance kept here for reference.
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-2 text-sm font-medium rounded-lg border border-sand-200 text-sand-600 hover:bg-sand-50 transition-colors shrink-0"
        >
          {showForm ? "Cancel" : "+ New Analysis"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-sand-200/60 p-5 space-y-3">
          <input
            type="text"
            placeholder="Title (e.g. Marketing Analysis — July 2026)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-900 bg-white"
          />
          <textarea
            placeholder={"Write the analysis here. Markdown basics supported:\n## Section heading\n- bullet point\n**bold**\n\nPasting a complete HTML document (starting with <!doctype html>) renders it as a full styled report instead."}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            className="w-full rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-900 bg-white font-mono leading-relaxed"
          />
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Analysis"}
          </button>
        </div>
      )}

      {analyses.map((a) => {
        const open = openId === a.id;
        return (
          <div key={a.id} className="bg-white rounded-xl border border-sand-200/60">
            <button
              onClick={() => setOpenId(open ? null : a.id)}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-sand-900">{a.title}</p>
                <p className="text-xs text-sand-400 mt-0.5">{formatDate(a.analysis_date)}</p>
              </div>
              <span className="text-sand-400 text-sm ml-4">{open ? "▲" : "▼"}</span>
            </button>
            {open && (
              <div className="px-5 pb-5 border-t border-sand-100 pt-4">
                {isHtmlContent(a.content) ? (
                  <HtmlReport html={a.content} />
                ) : (
                  <MarkdownLite content={a.content} />
                )}
                <div className="mt-5 flex items-center justify-end gap-2">
                  {confirmDeleteId === a.id ? (
                    <>
                      <span className="text-xs text-sand-500">Delete this analysis?</span>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-sand-200 text-sand-600 hover:bg-sand-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(a.id)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-sand-200 text-sand-400 hover:text-red-600 hover:border-red-200 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
