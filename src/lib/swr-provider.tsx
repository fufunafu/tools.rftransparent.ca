"use client";

import { SWRConfig } from "swr";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { redirectOnUnauthorized } from "@/lib/client-auth";

async function fetcher<T>(url: string): Promise<T> {
  // Retries transient network/5xx failures with backoff; 4xx pass through.
  const res = redirectOnUnauthorized(await fetchWithRetry(url));
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || "";
    } catch {
      // Non-JSON body — fall back to status text.
    }
    throw new Error(detail || `Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 5000,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
