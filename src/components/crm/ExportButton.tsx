"use client";
import { useState } from "react";
import { BUTTON, ErrorMessage } from "./shared";

/** Downloads the current list as CSV. Errors stay on the page instead of opening raw JSON. */
export default function ExportButton({ params, total }: { params: URLSearchParams; total?: number }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  async function download() {
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams(params); query.delete("page");
      const response = await fetch(`/api/crm/export?${query}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "Export failed"); }
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "crm-export.csv";
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Export failed")); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-end gap-1"><button type="button" className={BUTTON} disabled={busy || total === 0} onClick={() => void download()} title="Management only. Each export is logged.">{busy ? "Preparing CSV..." : "Export CSV"}</button>{error && <div className="max-w-sm"><ErrorMessage error={error} /></div>}</div>;
}
