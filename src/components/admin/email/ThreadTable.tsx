"use client";

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
}

export interface ThreadCounts {
  actionable: number;
  noise: number;
  dismissed: number;
  total: number;
}

interface Props {
  threads: UnansweredThread[];
  threadCounts: ThreadCounts;
  threadFilter: "actionable" | "noise" | "dismissed";
  onFilterChange: (f: "actionable" | "noise" | "dismissed") => void;
  onDismiss: (threadId: string) => void;
  onUndismiss: (threadId: string) => void;
  dismissingIds: Set<string>;
}

export default function ThreadTable({
  threads, threadCounts, threadFilter, onFilterChange, onDismiss, onUndismiss, dismissingIds,
}: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-sand-700">Unanswered Emails</h2>
        {(threadCounts.noise > 0 || threadCounts.dismissed > 0) && (
          <span className="text-[11px] text-sand-400">
            {threadCounts.noise > 0 && `${threadCounts.noise} auto-filtered`}
            {threadCounts.noise > 0 && threadCounts.dismissed > 0 && " · "}
            {threadCounts.dismissed > 0 && `${threadCounts.dismissed} dismissed`}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-sand-100 bg-sand-50/30">
          {([
            { key: "actionable" as const, label: "Needs Reply", count: threadCounts.actionable },
            { key: "noise" as const, label: "Auto-filtered", count: threadCounts.noise },
            { key: "dismissed" as const, label: "Dismissed", count: threadCounts.dismissed },
          ]).map((tab) => (
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

        {threads.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sand-500 text-sm">
              {threadFilter === "actionable" ? "All actionable emails have been answered or dismissed." :
               threadFilter === "noise" ? "No auto-filtered emails in this period." :
               "No dismissed emails."}
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
                  <th className="px-4 py-2.5 text-[11px] text-sand-400 uppercase tracking-wider font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => (
                  <tr key={t.thread_id} className="border-b border-sand-50 hover:bg-sand-50/50">
                    <td className="px-4 py-2.5 text-sand-700 font-medium">{t.from_email}</td>
                    <td className="px-4 py-2.5 text-sand-600 max-w-xs truncate" title={t.subject}>{t.subject}</td>
                    <td className="px-4 py-2.5 text-sand-500 whitespace-nowrap">{formatDateTime(t.received_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-amber-600 font-medium">{timeAgo(t.received_at)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {threadFilter === "actionable" && (
                        <button
                          onClick={() => onDismiss(t.thread_id)}
                          disabled={dismissingIds.has(t.thread_id)}
                          className="text-[11px] text-sand-400 hover:text-sand-600 disabled:opacity-50"
                          title="Mark as no response needed"
                        >
                          Dismiss
                        </button>
                      )}
                      {threadFilter === "dismissed" && (
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
