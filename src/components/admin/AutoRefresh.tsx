"use client";

import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

// Invisible companion for server-rendered pages: re-renders the route on an
// interval so the numbers stay current without any client-side data fetching.
// Pauses while the tab is hidden and catches up when it becomes visible.
export default function AutoRefresh({ intervalMs = 90_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useAutoRefresh(() => router.refresh(), { intervalMs });
  return null;
}
