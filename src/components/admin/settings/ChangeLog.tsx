import type { SettingChange } from "@/lib/settings-audit";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Recent changes to one settings area. Server component — the log is static
 * once rendered, so there's no reason to ship it to the client.
 */
export default function ChangeLog({
  changes,
  unavailable,
}: {
  changes: SettingChange[];
  unavailable: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-6">
      <h3 className="text-sm font-semibold text-sand-900">Recent changes</h3>

      {unavailable ? (
        <p className="text-xs text-sand-400 mt-2">
          Change history isn&apos;t being recorded yet — apply migration{" "}
          <code className="text-[11px] bg-sand-100 px-1 py-0.5 rounded">062_settings_audit.sql</code>{" "}
          in the Supabase SQL editor. Saving works either way.
        </p>
      ) : changes.length === 0 ? (
        <p className="text-xs text-sand-400 mt-2">Nothing changed here yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {changes.map((change) => (
            <li key={`${change.created_at}${change.summary}`} className="text-xs flex gap-3">
              <span className="text-sand-400 whitespace-nowrap shrink-0">{when(change.created_at)}</span>
              <span className="text-sand-700 flex-1">{change.summary}</span>
              <span className="text-sand-400 truncate max-w-[40%]">{change.actor}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
