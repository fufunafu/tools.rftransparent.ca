"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  DASHBOARD_OPTIONS,
  sanitizeAccountPreferences,
  type DashboardChoice,
} from "@/lib/account-preferences";

// The dashboard picker shown at the top of every dashboard. Picking one
// navigates there AND makes it the viewer's dashboard: the sidebar entry and
// "auto" sign-in landing follow it until they pick another. Everyone still
// starts on their role's default until they choose.

export function DashboardSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const choose = async (value: string) => {
    if (value === current || saving) return;
    setSaving(true);
    router.push(value);
    // Persist best-effort after navigating — a failed save must never block
    // the switch itself. rf_preferences is replaced wholesale by updateUser,
    // so merge on top of what's currently stored.
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data } = await supabase.auth.getUser();
      const metadata = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const preferences = {
        ...sanitizeAccountPreferences(metadata.rf_preferences),
        // The select's options all come from DASHBOARD_OPTIONS.
        dashboard: value as DashboardChoice,
      };
      const { error } = await supabase.auth.updateUser({ data: { rf_preferences: preferences } });
      if (!error) {
        window.dispatchEvent(
          new CustomEvent("rf:account-updated", { detail: { preferences } }),
        );
      }
    } catch {
      // Navigation already happened; the preference just didn't stick.
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-[11px] text-slate-400">Dashboard</span>
      <select
        value={current}
        onChange={(event) => choose(event.target.value)}
        aria-label="Switch dashboard"
        className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 transition-colors hover:border-blue-300 lg:min-h-7 lg:px-2"
      >
        {DASHBOARD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
