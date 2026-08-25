"use client";

import { useCallback, useEffect, useState } from "react";
import { useNativeRuntime } from "@/components/NativeAppRuntime";
import {
  getNativePermissionSnapshot,
  openNativeSettings,
  type NativePermissionSnapshot,
} from "@/lib/native-support";
import {
  getPushPreferences,
  registerForPush,
  updatePushPreferences,
  type PushPreferences,
} from "@/lib/app-push";
import { buildNativeDiagnosticReport } from "@/lib/native-diagnostics";

const DEFAULT_PERMISSIONS: NativePermissionSnapshot = {
  notifications: "unavailable",
  location: "unavailable",
  deviceAuthentication: "unavailable",
};

const PREFERENCE_LABELS: Array<[keyof PushPreferences, string, string]> = [
  ["task_updates", "Tasks", "Assigned tasks due today"],
  ["overdue_updates", "Overdue work", "A separate summary when tasks become overdue"],
  ["clock_reminders", "Clock reminders", "A reminder when a shift may still be running"],
  ["followup_updates", "Follow-ups", "Due and overdue follow-up summaries"],
  ["callback_updates", "Callbacks", "Assigned callback summaries"],
];

function PermissionValue({ value }: { value: string }) {
  return <span className="font-bold capitalize text-slate-800">{value}</span>;
}

export default function NativeSettingsPanel() {
  const runtime = useNativeRuntime();
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!runtime.isNative) return;
    setLoading(true);
    const [permissionResult, preferenceResult] = await Promise.allSettled([
      getNativePermissionSnapshot(),
      getPushPreferences(),
    ]);
    if (permissionResult.status === "fulfilled") setPermissions(permissionResult.value);
    if (preferenceResult.status === "fulfilled") setPreferences(preferenceResult.value);
    setLoading(false);
  }, [runtime.isNative]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    window.addEventListener("rf:app-resume", refresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("rf:app-resume", refresh);
    };
  }, [refresh]);

  const enableNotifications = async () => {
    setMessage(null);
    setLoading(true);
    const status = await registerForPush();
    if (status === "registered") {
      setMessage("Notifications are registered on this device.");
    } else if (status === "denied") {
      setMessage("Notification access is off. Enable it in iPhone Settings.");
    } else if (status === "failed") {
      setMessage("RF Tools could not register this device. Check your connection and try again.");
    } else {
      setMessage("Notifications are unavailable on this device.");
    }
    await refresh();
  };

  const togglePreference = async (field: keyof PushPreferences, enabled: boolean) => {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [field]: enabled });
    setMessage(null);
    try {
      setPreferences(await updatePushPreferences({ [field]: enabled }));
      setMessage("Notification preferences saved.");
    } catch (error) {
      setPreferences(previous);
      setMessage(error instanceof Error ? error.message : "Could not save notification preferences.");
    }
  };

  const shareDiagnostics = async () => {
    const report = buildNativeDiagnosticReport(runtime, permissions);
    try {
      if (navigator.share) {
        await navigator.share({ title: "RF Tools diagnostics", text: report });
        setMessage("Diagnostics ready to share.");
      } else {
        await navigator.clipboard.writeText(report);
        setMessage("Safe diagnostics copied.");
      }
    } catch {
      setMessage("Diagnostics were not shared.");
    }
  };

  return (
    <section aria-labelledby="native-app-settings">
      <h2 id="native-app-settings" className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
        App settings and diagnostics
      </h2>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div><dt className="text-slate-500">Connection</dt><dd className={`mt-0.5 font-bold ${runtime.connected ? "text-emerald-700" : "text-amber-800"}`}>{runtime.connected ? `Online${runtime.connectionType !== "unknown" ? ` · ${runtime.connectionType}` : ""}` : "Offline"}</dd></div>
          <div><dt className="text-slate-500">Environment</dt><dd className="mt-0.5 font-bold capitalize text-slate-800">{runtime.environment}</dd></div>
          <div><dt className="text-slate-500">App version</dt><dd className="mt-0.5 font-bold text-slate-800">{runtime.appVersion ?? (runtime.isNative ? "Unavailable" : "Web")}</dd></div>
          <div><dt className="text-slate-500">Build</dt><dd className="mt-0.5 font-bold text-slate-800">{runtime.buildNumber ?? (runtime.isNative ? "Unavailable" : "Web")}</dd></div>
          {runtime.isNative && <>
            <div><dt className="text-slate-500">Operating system</dt><dd className="mt-0.5 font-bold text-slate-800">{runtime.operatingSystem ?? "Unavailable"}</dd></div>
            <div><dt className="text-slate-500">Device</dt><dd className="mt-0.5 font-bold text-slate-800">{runtime.deviceModel ?? "Unavailable"}</dd></div>
            <div><dt className="text-slate-500">Notifications</dt><dd className="mt-0.5"><PermissionValue value={permissions.notifications} /></dd></div>
            <div><dt className="text-slate-500">Location</dt><dd className="mt-0.5"><PermissionValue value={permissions.location} /></dd></div>
            <div><dt className="text-slate-500">Device authentication</dt><dd className="mt-0.5"><PermissionValue value={permissions.deviceAuthentication} /></dd></div>
            <div><dt className="text-slate-500">Service</dt><dd className="mt-0.5"><PermissionValue value={runtime.serviceState} /></dd></div>
            <div><dt className="text-slate-500">Native crash reports</dt><dd className="mt-0.5 font-bold text-slate-800">{runtime.nativeCrashCount ?? 0}</dd></div>
            <div><dt className="text-slate-500">WebView load failures</dt><dd className="mt-0.5 font-bold text-slate-800">{runtime.webViewLoadFailureCount ?? 0}</dd></div>
          </>}
        </dl>

        {runtime.isNative && (
          <>
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-bold text-slate-900">Notification preferences</h3>
              {permissions.notifications !== "granted" ? (
                <div className="mt-2 space-y-2">
                  <p className="leading-5 text-slate-600">Notifications are {permissions.notifications}. Enable them here or recover denied access in iPhone Settings.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={loading} onClick={() => void enableNotifications()} className="min-h-11 rounded-xl bg-blue-600 px-3 font-bold text-white disabled:opacity-50">Enable</button>
                    <button type="button" onClick={() => void openNativeSettings()} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-700">Open Settings</button>
                  </div>
                </div>
              ) : preferences ? (
                <div className="mt-2 divide-y divide-slate-200">
                  {PREFERENCE_LABELS.map(([field, label, description]) => (
                    <label key={field} className="flex min-h-14 items-center gap-3 py-2">
                      <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">{label}</span><span className="block leading-5 text-slate-500">{description}</span></span>
                      <input type="checkbox" checked={preferences[field]} onChange={(event) => void togglePreference(field, event.target.checked)} className="h-6 w-6 accent-blue-600" />
                    </label>
                  ))}
                </div>
              ) : (
                <button type="button" onClick={() => void enableNotifications()} className="mt-3 min-h-11 w-full rounded-xl bg-blue-600 px-3 font-bold text-white">Register this device</button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-700">Refresh status</button>
              <button type="button" onClick={() => void shareDiagnostics()} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-700">Share diagnostics</button>
              <a href="/privacy" className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-700">Privacy</a>
              <a href="mailto:info@glass-railing.com?subject=RF%20Tools%20support" className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 font-bold text-slate-700">Contact support</a>
            </div>
            {(["denied", "restricted"].includes(permissions.location) || ["denied", "restricted"].includes(permissions.notifications)) && (
              <button type="button" onClick={() => void openNativeSettings()} className="mt-3 min-h-11 w-full rounded-xl bg-slate-900 px-3 font-bold text-white">Open iPhone Settings</button>
            )}
            {runtime.updateState !== "current" && runtime.updateState !== "unknown" && runtime.updateUrl && (
              <a href={runtime.updateUrl} className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-3 font-bold text-white">Update RF Tools</a>
            )}
          </>
        )}
        {message && <p className="mt-3 rounded-lg bg-white px-3 py-2 font-semibold text-slate-700" role="status">{message}</p>}
      </div>
    </section>
  );
}
