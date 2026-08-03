"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WallAnnouncement } from "@/lib/settings";

/**
 * The banner across the top of the office wall board. One message, 200
 * characters — the TV is glanced at across a room, not read.
 */
export default function WallAnnouncementForm({
  initial,
  canEdit,
}: {
  initial: WallAnnouncement | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState(initial?.message ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/wall-announcement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save the announcement");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-900">Wall board announcement</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            One line across the top of the office TV — schedule changes, counts, closures.
            Signed with your name. Clear the text to take it down.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : message.trim() ? "Post to the wall" : "Clear the wall"}
          </button>
        )}
      </div>

      <textarea
        value={message}
        disabled={!canEdit}
        maxLength={200}
        rows={2}
        onChange={(e) => {
          setMessage(e.target.value);
          setSaved(false);
        }}
        placeholder="Inventory count Saturday 8am — no pickups before 11am."
        className="mt-4 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y disabled:bg-slate-50 disabled:text-slate-400"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-slate-400">
          {initial
            ? `Currently posted by ${initial.author} · ${new Date(initial.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : "Nothing posted right now"}
        </span>
        <span className="text-[11px] text-slate-300 tabular-nums">{message.length}/200</span>
      </div>

      {!canEdit && (
        <p className="text-xs text-slate-400 mt-2">Only an admin can post to the wall.</p>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-600 mt-2">On the wall.</p>}
    </section>
  );
}
