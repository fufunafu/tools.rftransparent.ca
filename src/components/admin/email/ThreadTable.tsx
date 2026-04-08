"use client";

import { useState, useMemo } from "react";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export interface UnansweredThread {
  thread_id: string;
  subject: string;
  from_email: string;
  received_at: string;
  message_count: number;
  snippet: string;
  is_noise: boolean;
  is_dismissed: boolean;
  resolution_type?: "dismissed" | "resolved";
}

export interface ThreadCounts {
  actionable: number;
  noise: number;
  dismissed: number;
  resolved: number;
  total: number;
}

type ThreadFilter = "actionable" | "noise" | "dismissed" | "resolved";

interface Props {
  threads: UnansweredThread[];
  threadCounts: ThreadCounts;
  threadFilter: ThreadFilter;
  onFilterChange: (f: ThreadFilter) => void;
  onDismiss: (threadId: string) => void;
  onUndismiss: (threadId: string) => void;
  onResolve: (threadId: string) => void;
  onAddNoise: (domain: string, threadId: string) => void;
  dismissingIds: Set<string>;
  resolvingIds: Set<string>;
}

export default function ThreadTable({
  threads, threadCounts, threadFilter, onFilterChange,
  onDismiss, onUndismiss, onResolve, onAddNoise,
  dismissingIds, resolvingIds,
}: Props) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.toLowerCase();
    return threads.filter((t) =>
      t.subject.toLowerCase().includes(q) || t.from_email.toLowerCase().includes(q)
    );
  }, [threads, search]);

  const emptyMessage: Record<ThreadFilter, string> = {
    actionable: "All actionable emails have been answered or dismissed.",
    noise: "No auto-filtered emails in this period.",
    dismissed: "No dismissed emails.",
    resolved: "No resolved emails.",
  };

  const tabs: { key: ThreadFilter; label: string; count: number }[] = [
    { key: "actionable", label: "Needs Reply", count: threadCounts.actionable },
    { key: "noise", label: "Auto-filtered", count: threadCounts.noise },
    { key: "dismissed", label: "Dismissed", count: threadCounts.dismissed },
    { key: "resolved", label: "Resolved", count: threadCounts.resolved },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <h2 className="text-sm font-semibold text-sand-700 shrink-0">Unanswered Emails</h2>
        <input
          type="text"
          placeholder="Search subject or sender..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs px-3 py-1 text-xs border border-sand-200 rounded-lg bg-white text-sand-700 placeholder:text-sand-400 focus:outline-none focus:ring-1 focus:ring-sand-400"
        />
      </div>

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-sand-100 bg-sand-50/30">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onFilterChange(tab.key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                threadFilter === tab.key ? "bg-white text-sand-900 shadow-sm" : "text-sand-500 hover:text-sand-700"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sand-500 text-sm">
              {search ? `No emails matching "${search}".` : emptyMessage[threadFilter]}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 text-left">
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">From</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Subject</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Received</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Waiting</th>
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium w-40"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.thread_id} className="border-b border-sand-50 hover:bg-sand-50/50">
                    <td className="px-4 py-2.5 text-sand-700 font-medium text-xs">{t.from_email}</td>
                    <td className="px-4 py-2.5 text-sand-600 max-w-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate" title={t.subject}>{t.subject || "(no subject)"}</span>
                        <a
                          href={`https://mail.google.com/mail/#all/${t.thread_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in Gmail"
                          className="shrink-0 text-sand-300 hover:text-blue-500 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                            <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sand-500 whitespace-nowrap text-xs">{formatDateTime(t.received_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-amber-600 font-medium">{timeAgo(t.received_at)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {threadFilter === "actionable" && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => onResolve(t.thread_id)}
                            disabled={resolvingIds.has(t.thread_id)}
                            className="text-[11px] text-emerald-600 hover:text-emerald-800 disabled:opacity-50 font-medium"
                            title="Mark as handled (called / resolved without email reply)"
                          >
                            Resolved
                          </button>
                          <button
                            onClick={() => onDismiss(t.thread_id)}
                            disabled={dismissingIds.has(t.thread_id)}
                            className="text-[11px] text-sand-400 hover:text-sand-600 disabled:opacity-50"
                            title="Mark as no response needed"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => {
                              const domain = t.from_email.split("@")[1];
                              if (domain) onAddNoise(domain, t.thread_id);
                            }}
                            className="text-[11px] text-sand-300 hover:text-sand-500"
                            title="Add sender domain to noise filter"
                          >
                            → Noise
                          </button>
                        </div>
                      )}
                      {(threadFilter === "dismissed" || threadFilter === "resolved") && (
                        <button
                          onClick={() => onUndismiss(t.thread_id)}
                          disabled={dismissingIds.has(t.thread_id)}
                          className="text-[11px] text-sand-400 hover:text-sand-600 disabled:opacity-50"
                          title="Move back to needs reply"
                        >
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
