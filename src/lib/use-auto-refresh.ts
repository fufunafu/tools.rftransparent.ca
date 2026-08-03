"use client";

// Shared visibility-aware auto-refresh. Generalizes the pattern proven in
// FollowUpDashboard: poll on an interval, but only while the tab is visible,
// never overlap runs, and catch up immediately when the tab comes back if the
// data has gone stale. Does NOT fire on mount — every consumer already loads
// its data on mount; the first tick lands after intervalMs.

import { useEffect, useRef } from "react";

export interface AutoRefreshOptions {
  /** Tick period. Default 60s. */
  intervalMs?: number;
  /** Master switch (e.g. a user toggle). Default true. */
  enabled?: boolean;
  /** On tab-visible, fire immediately if the last run is older than this.
   *  Default: intervalMs. */
  staleAfterMs?: number;
}

export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  { intervalMs = 60_000, enabled = true, staleAfterMs }: AutoRefreshOptions = {}
): void {
  // Latest callback lives in a ref so callers don't need useCallback and a
  // changing identity never resets the timer.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const staleMs = staleAfterMs ?? intervalMs;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let inFlight = false;
    let lastRunAt = Date.now();

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== "visible") return;
      inFlight = true;
      lastRunAt = Date.now();
      try {
        await refreshRef.current();
      } catch {
        // Consumers surface their own errors; a failed background refresh
        // must never take the page down.
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunAt > staleMs) {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, staleMs]);
}
