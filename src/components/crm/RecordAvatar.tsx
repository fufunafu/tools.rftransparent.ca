"use client";

import { useState } from "react";
import Image from "next/image";
import { recordImageSources } from "@/lib/crm/record-images.mjs";
import type { CrmRecord } from "@/lib/crm/types";

type AvatarRecord = Pick<CrmRecord, "object_type" | "title" | "view_fields">;
const COLORS = ["bg-cyan-50 text-cyan-800", "bg-violet-50 text-violet-800", "bg-amber-50 text-amber-800", "bg-rose-50 text-rose-800", "bg-emerald-50 text-emerald-800"];

export default function RecordAvatar({ record, size = "small" }: { record: AvatarRecord; size?: "small" | "large" }) {
  const sources = recordImageSources(record) as string[];
  return <AvatarImage key={sources.join("|")} record={record} sources={sources} size={size} />;
}

function AvatarImage({ record, sources, size }: { record: AvatarRecord; sources: string[]; size: "small" | "large" }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const title = record.title.includes("@") ? record.title.split("@")[0].replace(/[._+-]/g, " ") : record.title;
  const initials = title.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase() || "?";
  const color = Array.from(record.title).reduce((hash, letter) => (hash + letter.charCodeAt(0)) % COLORS.length, 0);
  const dimension = size === "large" ? 56 : 32;
  return <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-black/5 font-semibold ${record.object_type === "companies" ? "rounded-lg" : "rounded-full"} ${size === "large" ? "h-14 w-14 text-lg" : "h-8 w-8 text-[11px]"} ${COLORS[color]}`}>
    {initials}
    {sources[sourceIndex] && <Image key={sources[sourceIndex]} src={sources[sourceIndex]} alt="" width={dimension} height={dimension} unoptimized loading="lazy" referrerPolicy="no-referrer" onError={() => setSourceIndex(index => index + 1)} className="absolute inset-0 h-full w-full bg-white object-contain p-1" />}
  </span>;
}
