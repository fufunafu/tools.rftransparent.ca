"use client";
import { useState } from "react";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} className="min-h-8 rounded px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy"}</button>;
}

function websiteUrl(value: string) {
  try { const url = new URL(value.includes("://") ? value : `https://${value}`); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; }
  catch { return null; }
}

/** Email, phone and website with one-tap actions. Blank values say "Not set". */
export default function ContactPoint({ kind, value }: { kind: "email" | "phone" | "website"; value?: string }) {
  if (!value) return <span className="text-slate-400">Not set</span>;
  const href = kind === "email" ? `mailto:${value}` : kind === "phone" ? `tel:${value.replace(/[^\d+]/g, "")}` : websiteUrl(value);
  return <span className="flex min-w-0 items-center gap-1">
    {href ? <a href={href} target={kind === "website" ? "_blank" : undefined} rel={kind === "website" ? "noreferrer" : undefined} className="min-w-0 break-all font-medium text-cyan-800 hover:underline">{value}</a> : <span className="break-all">{value}</span>}
    <CopyButton value={value} label={kind} />
  </span>;
}
